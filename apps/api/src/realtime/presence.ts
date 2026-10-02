import { presenceColor, type PresenceEntry } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { diagramRoom } from './rooms.js';
import type { RealtimeServer, RealtimeSocket } from './server.js';

/** Lo que guarda cada socket conectado a un diagrama (un campo del hash por socket). */
export type SocketPresence = {
  userId: string;
  name: string;
  selectedActivityKey: string | null;
  /** Cuándo eligió esa actividad: con varias pestañas manda la última selección. */
  selectedAt: number;
  /** Última señal de vida (epoch ms). */
  lastSeen: number;
};

export type PresenceConfig = {
  /** Sin latido en este plazo, el socket deja de contar (10 s, US2 escenario 2). */
  presenceTtlMs?: number;
  /** Cada cuánto se barren las entradas sin latido (5 s). */
  sweepIntervalMs?: number;
};

/** Como mucho 50 personas en `presence:update` (SC-002). */
const MAX_ENTRIES = 50;
/** La clave caduca si nadie la actualiza en una hora (data-model). */
const KEY_TTL_MS = 3_600_000;

/**
 * Estado de la presencia: una entrada por persona aunque tenga varias pestañas, sin los sockets
 * que no han dado señal de vida en el plazo, ordenada por nombre.
 */
export function presenceState(
  sockets: SocketPresence[],
  now: number,
  ttlMs: number,
): PresenceEntry[] {
  const byUser = new Map<string, SocketPresence>();
  for (const socket of sockets) {
    if (now - socket.lastSeen > ttlMs) continue;
    const current = byUser.get(socket.userId);
    if (!current || socket.selectedAt > current.selectedAt) byUser.set(socket.userId, socket);
  }
  return [...byUser.values()]
    .map(({ userId, name, selectedActivityKey }) => ({
      userId,
      name,
      color: presenceColor(userId),
      selectedActivityKey,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es') || a.userId.localeCompare(b.userId))
    .slice(0, MAX_ENTRIES);
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Presencia por diagrama (feature 005, research R5). */
    presence: PresenceService;
  }
}

/**
 * Presencia en Redis (research R5): hash `presence:{versionId}` con un campo por socket
 * (`{userId}:{socketId}`), de modo que varias pestañas o réplicas no compiten por un contador.
 * Cada cambio reparte el estado completo a la sala del diagrama.
 */
export function createPresence(
  app: FastifyInstance,
  io: RealtimeServer,
  { prefix, presenceTtlMs = 10_000, sweepIntervalMs = 5_000 }: PresenceConfig & { prefix: string },
) {
  const key = (versionId: string) => `${prefix}presence:${versionId}`;
  const field = (socket: RealtimeSocket) => `${socket.data.userId}:${socket.id}`;
  const lockKey = `${prefix}presence:sweep:lock`;
  /** Al cerrar la app ya no se reparte nada: los sockets se están cerrando. */
  let stopped = false;

  async function read(versionId: string): Promise<Array<[string, SocketPresence]>> {
    const raw = await app.redis.hgetall(key(versionId));
    return Object.entries(raw).flatMap(([name, value]) => {
      try {
        return [[name, JSON.parse(value) as SocketPresence]];
      } catch {
        return [];
      }
    });
  }

  async function state(versionId: string): Promise<PresenceEntry[]> {
    const entries = await read(versionId);
    return presenceState(
      entries.map(([, value]) => value),
      Date.now(),
      presenceTtlMs,
    );
  }

  async function broadcast(versionId: string) {
    if (stopped) return;
    io.to(diagramRoom(versionId)).emit('presence:update', { entries: await state(versionId) });
  }

  async function write(versionId: string, socket: RealtimeSocket, value: SocketPresence) {
    await app.redis
      .multi()
      .hset(key(versionId), field(socket), JSON.stringify(value))
      .pexpire(key(versionId), KEY_TTL_MS)
      .exec();
  }

  async function current(versionId: string, socket: RealtimeSocket) {
    const raw = await app.redis.hget(key(versionId), field(socket));
    return raw ? (JSON.parse(raw) as SocketPresence) : null;
  }

  const service = {
    state,

    /** Deja de repartir y de barrer (al cerrar la app, antes de desconectar los sockets). */
    stop() {
      stopped = true;
      clearInterval(timer);
    },

    /** Al unirse: cuenta el socket y reparte el estado; devuelve el estado para el ack. */
    async join(versionId: string, socket: RealtimeSocket): Promise<PresenceEntry[]> {
      await write(versionId, socket, {
        userId: socket.data.userId,
        name: socket.data.name,
        selectedActivityKey: null,
        selectedAt: 0,
        lastSeen: Date.now(),
      });
      const entries = await state(versionId);
      if (!stopped) io.to(diagramRoom(versionId)).emit('presence:update', { entries });
      return entries;
    },

    async leave(versionId: string, socket: RealtimeSocket) {
      await app.redis.hdel(key(versionId), field(socket));
      await broadcast(versionId);
    },

    /** Latido: solo renueva `lastSeen` (no reparte nada; nadie cambia de estado). */
    async heartbeat(versionId: string, socket: RealtimeSocket) {
      const value = await current(versionId, socket);
      if (value) await write(versionId, socket, { ...value, lastSeen: Date.now() });
    },

    async select(versionId: string, socket: RealtimeSocket, activityKey: string | null) {
      const value = await current(versionId, socket);
      if (!value) return;
      const now = Date.now();
      await write(versionId, socket, {
        ...value,
        selectedActivityKey: activityKey,
        selectedAt: now,
        lastSeen: now,
      });
      await broadcast(versionId);
    },

    /**
     * Barre los sockets sin latido de todos los diagramas. Lo hace una sola réplica a la vez
     * (`SET NX`); devuelve si le tocó a esta.
     */
    async sweep(): Promise<boolean> {
      const locked = await app.redis.set(
        lockKey,
        '1',
        'PX',
        Math.max(100, sweepIntervalMs - 50),
        'NX',
      );
      if (locked !== 'OK') return false;
      let cursor = '0';
      do {
        const [next, keys] = await app.redis.scan(
          cursor,
          'MATCH',
          `${prefix}presence:*`,
          'COUNT',
          100,
        );
        cursor = next;
        for (const versionKey of keys) {
          if (versionKey === lockKey) continue;
          const versionId = versionKey.slice(`${prefix}presence:`.length);
          const now = Date.now();
          const stale = (await read(versionId))
            .filter(([, value]) => now - value.lastSeen > presenceTtlMs)
            .map(([name]) => name);
          if (stale.length === 0) continue;
          await app.redis.hdel(versionKey, ...stale);
          await broadcast(versionId);
        }
      } while (cursor !== '0');
      return true;
    },
  };

  const timer = setInterval(() => {
    service
      .sweep()
      .catch((error: Error) =>
        app.log.warn({ err: { name: error.name } }, 'Falló el barrido de presencia'),
      );
  }, sweepIntervalMs);
  timer.unref();

  return service;
}

export type PresenceService = ReturnType<typeof createPresence>;
