import { hostname } from 'node:os';
import { createAdapter } from '@socket.io/redis-adapter';
import {
  AuthRefreshSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import { Types } from 'mongoose';
import { Server, type Socket } from 'socket.io';
import { usersModel } from '../modules/users/model.js';
import { registerBridge } from './bridge.js';
import { registerCursors } from './cursors.js';
import { createPresence, type PresenceConfig } from './presence.js';
import { registerRevocation } from './revocation.js';
import { registerRooms } from './rooms.js';

export type RealtimeConfig = PresenceConfig & {
  /** Margen tras la caducidad del access token antes de desconectar (60 s por defecto). */
  tokenGraceMs?: number;
  /** Prefijo de los canales del adaptador Redis; las pruebas usan uno propio. */
  adapterKey?: string;
  /** Prefijo de las claves de Redis (presencia); las pruebas usan uno propio. */
  keyPrefix?: string;
  /** Identificador de la réplica en los logs (`RAILWAY_REPLICA_ID` o el hostname). */
  replicaId?: string;
  /** Intervalo del ping de Engine.IO (25 s por defecto); las pruebas lo acortan. */
  pingIntervalMs?: number;
};

export type SocketData = {
  userId: string;
  name: string;
  /** Caducidad del access token vigente (epoch ms). */
  tokenExpiresAt: number;
  /**
   * Versiones a cuya sala se ha unido, con su proyecto. Objeto plano: viaja entre réplicas con
   * `fetchSockets` (revocación). Las comprobaciones de sala usan `socket.rooms`, que es lo que
   * cuenta tras un `socketsLeave` remoto.
   */
  joined: Record<string, string>;
};

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
export type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

declare module 'fastify' {
  interface FastifyInstance {
    /** Servidor Socket.IO (feature 005), solo con el flag `realtime`. */
    io: RealtimeServer;
  }
}

type AccessPayload = { sub: string; exp: number };

/** Verifica un access token de la 002; `null` si no es válido o ha caducado. */
function verifyToken(app: FastifyInstance, token: unknown): AccessPayload | null {
  if (typeof token !== 'string' || token === '') return null;
  try {
    const payload = app.jwt.verify<AccessPayload>(token);
    return Types.ObjectId.isValid(payload.sub) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Observabilidad (constitución VI): conexiones y desconexiones por réplica, con la latencia del
 * ping de Engine.IO (el servidor envía `ping` y el cliente responde `pong`). Sin tokens ni
 * payloads: solo identificadores.
 */
function observe(
  app: FastifyInstance,
  io: RealtimeServer,
  socket: RealtimeSocket,
  replica: string,
) {
  const connectedAt = Date.now();
  const context = { socketId: socket.id, userId: socket.data.userId, replica };
  app.log.info(
    { ...context, event: 'socket.connected', connections: io.engine.clientsCount },
    'Socket conectado',
  );
  let pingSentAt: number | undefined;
  let pingMs: number | undefined;
  let pingMaxMs: number | undefined;
  socket.conn.on('packetCreate', (packet: { type: string }) => {
    if (packet.type === 'ping') pingSentAt = Date.now();
  });
  socket.conn.on('packet', (packet: { type: string }) => {
    if (packet.type !== 'pong' || pingSentAt === undefined) return;
    pingMs = Date.now() - pingSentAt;
    pingMaxMs = Math.max(pingMaxMs ?? 0, pingMs);
    pingSentAt = undefined;
    app.log.debug({ ...context, event: 'socket.ping', pingMs }, 'Latencia del ping');
  });
  socket.on('disconnect', (reason) =>
    app.log.info(
      {
        ...context,
        event: 'socket.disconnected',
        reason,
        durationMs: Date.now() - connectedAt,
        pingMs,
        pingMaxMs,
        connections: io.engine.clientsCount,
      },
      'Socket desconectado',
    ),
  );
}

function duplicate(app: FastifyInstance, role: string): Redis {
  const client = app.redis.duplicate();
  client.on('error', (error: Error) =>
    app.log.warn({ err: { name: error.name }, role }, 'Redis del adaptador no disponible'),
  );
  client.connect().catch(() => {});
  return client;
}

/**
 * Cierra una conexión del adaptador sin dejar comandos pendientes rechazados: si aún está
 * conectando (la app se cierra nada más arrancar), espera a que esté lista, como mucho 1 s.
 */
async function closeClient(client: Redis) {
  if (client.status === 'connecting' || client.status === 'connect') {
    await Promise.race([
      new Promise((resolve) => client.once('ready', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
  if (client.status === 'ready') await client.quit().catch(() => client.disconnect());
  else client.disconnect();
}

/**
 * Socket.IO sobre el servidor HTTP de Fastify (plan de la 005, ajustes 1, 2 y 5): solo
 * WebSocket (Railway no garantiza sesiones persistentes), adaptador Redis para repartir las
 * emisiones entre réplicas y el JWT de la 002 en el handshake.
 */
export const realtimePlugin = fp<RealtimeConfig>(
  async (
    app,
    {
      tokenGraceMs = 60_000,
      adapterKey = 'socket.io',
      keyPrefix = '',
      replicaId = process.env.RAILWAY_REPLICA_ID ?? hostname(),
      pingIntervalMs = 25_000,
      ...timings
    },
  ) => {
    const pub = duplicate(app, 'pub');
    const sub = duplicate(app, 'sub');
    const io: RealtimeServer = new Server(app.server, {
      transports: ['websocket'],
      serveClient: false,
      pingInterval: pingIntervalMs,
      adapter: createAdapter(pub, sub, { key: adapterKey }),
    });
    const Users = usersModel(app.mongo);
    const presence = createPresence(app, io, { prefix: keyPrefix, ...timings });

    io.use(async (socket, next) => {
      const payload = verifyToken(app, socket.handshake.auth?.token);
      if (!payload) return next(new Error('unauthorized'));
      const user = await Users.findById(payload.sub, { name: 1 }).lean<{ name: string }>();
      if (!user) return next(new Error('unauthorized'));
      socket.data = {
        userId: payload.sub,
        name: user.name,
        tokenExpiresAt: payload.exp * 1000,
        joined: {},
      };
      next();
    });

    io.on('connection', (socket: RealtimeSocket) => {
      void socket.join(`user:${socket.data.userId}`);
      observe(app, io, socket, replicaId);

      // Sin renovar el token, el socket se desconecta pasado el margen (research R2).
      let expiry: NodeJS.Timeout | undefined;
      const scheduleExpiry = () => {
        clearTimeout(expiry);
        const delay = Math.max(0, socket.data.tokenExpiresAt + tokenGraceMs - Date.now());
        expiry = setTimeout(() => socket.disconnect(true), delay);
      };
      scheduleExpiry();
      socket.on('disconnect', () => clearTimeout(expiry));

      socket.on('auth:refresh', (input, ack) => {
        const parsed = AuthRefreshSchema.safeParse(input);
        const payload = parsed.success ? verifyToken(app, parsed.data.token) : null;
        const ok = payload?.sub === socket.data.userId;
        if (ok) {
          socket.data.tokenExpiresAt = payload!.exp * 1000;
          scheduleExpiry();
        }
        if (typeof ack === 'function') ack({ ok });
      });

      registerRooms(app, socket, presence);
      registerCursors(app, socket);
    });

    app.decorate('io', io);
    app.decorate('presence', presence);
    registerBridge(app);
    registerRevocation(app, presence);
    // Antes de cerrar el servidor HTTP: Fastify lo cierra después.
    app.addHook('preClose', async () => {
      presence.stop();
      io.local.disconnectSockets(true);
      io.engine.close();
    });
    app.addHook('onClose', async () => {
      await Promise.all([closeClient(pub), closeClient(sub)]);
    });
  },
  { name: 'realtime', dependencies: ['redis', 'auth', 'mongo', 'domain-events'] },
);
