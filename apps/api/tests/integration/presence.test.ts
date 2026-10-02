import {
  PRESENCE_COLORS,
  PresenceUpdateSchema,
  presenceColor,
  type PresenceEntry,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { publishedDiagram } from '../helpers/details';
import { closeSockets, collect, connect, pause, type ClientSocket } from '../helpers/realtime';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US2 de la 005 (FR-003, FR-004; research R5): presencia por diagrama en Redis, agregada por
// persona, con latido y barrido. Tiempos cortos inyectados.

const PRESENCE = { presenceTtlMs: 600, sweepIntervalMs: 200 };
let app: FastifyInstance;
let replica: FastifyInstance;
let url: string;
let replicaUrl: string;
let ana: TestUser;
let luis: TestUser;
let marta: TestUser;
let versionId: string;

beforeAll(async () => {
  let dbName: string;
  ({ app, dbName } = await buildTestApp('presence', {
    withAuth: true,
    featureFlags: 'realtime=true',
    realtime: PRESENCE,
  }));
  ({ app: replica } = await buildTestApp('presence', {
    withAuth: true,
    featureFlags: 'realtime=true',
    realtime: PRESENCE,
    dbName,
  }));
  url = await app.listen({ port: 0, host: '127.0.0.1' });
  replicaUrl = await replica.listen({ port: 0, host: '127.0.0.1' });
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
  marta = await registerTestUser(app, 'Marta');
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
      [marta, 'participant'],
    ],
  });
  versionId = (await publishedDiagram(app, authHeaders(ana), projectId)).versionId;
});
afterEach(() => closeSockets());
afterAll(async () => {
  await replica.close();
  await closeTestApp(app);
});

type Update = { entries: PresenceEntry[] };
const names = (update: Update) => update.entries.map((entry) => entry.name).sort();

async function join(
  user: TestUser,
  at = url,
): Promise<{ socket: ClientSocket; presence: PresenceEntry[] }> {
  const socket = await connect(at, user.accessToken);
  const ack = await socket.timeout(2000).emitWithAck('room:join', { versionId });
  if (!ack.ok) throw new Error('room:join rechazado');
  return { socket, presence: ack.presence };
}

/** Espera la siguiente presencia que cumpla `ready`. */
function presenceWhere(socket: ClientSocket, ready: (update: Update) => boolean, timeoutMs = 3000) {
  return new Promise<Update>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sin la presencia esperada')), timeoutMs);
    const handler = (update: Update) => {
      if (!ready(update)) return;
      clearTimeout(timer);
      socket.off('presence:update', handler);
      resolve(update);
    };
    socket.on('presence:update', handler);
  });
}

describe('entrar y salir', () => {
  it('room:join devuelve el estado y reparte presence:update completo y válido', async () => {
    const { socket: anaSocket, presence } = await join(ana);
    expect(presence.map((entry) => entry.name)).toEqual([ana.name]);
    const update = presenceWhere(anaSocket, (u) => u.entries.length === 2);
    await join(luis);
    const full = await update;
    expect(PresenceUpdateSchema.parse(full)).toEqual(full);
    expect(names(full)).toEqual([ana.name, luis.name].sort());
    expect(full.entries.find((entry) => entry.userId === luis.id)).toEqual({
      userId: luis.id,
      name: luis.name,
      color: presenceColor(luis.id),
      selectedActivityKey: null,
    });
    expect(PRESENCE_COLORS).toContain(full.entries[0]!.color);
  });

  it('dos pestañas cuentan como una y la persona desaparece al cerrar la última', async () => {
    const { socket: observer } = await join(ana);
    const first = await join(luis);
    const second = await join(luis);
    expect(second.presence.filter((entry) => entry.userId === luis.id)).toHaveLength(1);

    first.socket.close();
    await pause(300);
    const state = await app.presence.state(versionId);
    expect(state.filter((entry) => entry.userId === luis.id)).toHaveLength(1);

    const gone = presenceWhere(observer, (u) => !names(u).includes(luis.name));
    second.socket.close();
    await gone;
  });

  it('room:leave saca a la persona de la presencia', async () => {
    const { socket: observer } = await join(ana);
    const { socket } = await join(luis);
    const gone = presenceWhere(observer, (u) => !names(u).includes(luis.name));
    socket.emit('room:leave', { versionId });
    await gone;
  });
});

describe('latido y barrido', () => {
  it('quien no da señal de vida desaparece pasado el plazo; con latido sigue', async () => {
    const { socket: observer } = await join(ana);
    const quiet = await join(marta);
    // Ana late; Marta no (simula una pestaña colgada: el socket sigue abierto).
    const beat = setInterval(() => observer.emit('presence:heartbeat', { versionId }), 150);
    try {
      const update = await presenceWhere(observer, (u) => !names(u).includes(marta.name), 3000);
      expect(names(update)).toContain(ana.name);
      expect(quiet.socket.connected).toBe(true);
    } finally {
      clearInterval(beat);
    }
  });

  it('un solo barrido a la vez entre instancias', async () => {
    // El barrido periódico también compite por el bloqueo: se repite hasta que lo gane una.
    let won = 0;
    for (let i = 0; i < 20 && won === 0; i++) {
      const results = await Promise.all([app.presence.sweep(), replica.presence.sweep()]);
      expect(results.filter(Boolean).length).toBeLessThanOrEqual(1);
      won = results.filter(Boolean).length;
      if (won === 0) await pause(60);
    }
    expect(won).toBe(1);
  });
});

describe('selección', () => {
  it('presence:select se reparte con la actividad seleccionada', async () => {
    const { socket: observer } = await join(ana);
    const { socket } = await join(luis);
    const selected = presenceWhere(observer, (u) =>
      u.entries.some((entry) => entry.userId === luis.id && entry.selectedActivityKey === 'k1'),
    );
    socket.emit('presence:select', { versionId, activityKey: 'k1' });
    await selected;
  });

  it('se limita a 10 por segundo', async () => {
    const { socket: observer } = await join(ana);
    const { socket } = await join(luis);
    await pause(100);
    const updates = collect<Update>(observer, 'presence:update');
    for (let i = 0; i < 30; i++)
      socket.emit('presence:select', { versionId, activityKey: `k${i}` });
    await pause(400);
    expect(updates.length).toBeLessThanOrEqual(10);
  });

  it('presence:select y presence:heartbeat de un socket que no está en la sala se ignoran (S1)', async () => {
    const { socket: observer } = await join(ana);
    await pause(100);
    const updates = collect<Update>(observer, 'presence:update');
    const outsider = await connect(url, luis.accessToken);
    outsider.emit('presence:select', { versionId, activityKey: 'k1' });
    outsider.emit('presence:heartbeat', { versionId });
    await pause(300);
    expect(updates).toEqual([]);
  });

  it('un payload inválido se descarta sin repartir nada', async () => {
    const { socket: observer } = await join(ana);
    const { socket } = await join(luis);
    await pause(100);
    const updates = collect<Update>(observer, 'presence:update');
    socket.emit('presence:select', { versionId, activityKey: '' } as never);
    socket.emit('presence:heartbeat', {} as never);
    await pause(300);
    expect(updates).toEqual([]);
  });
});

describe('varias instancias', () => {
  it('la presencia es la misma en ambas', async () => {
    const { socket: onApp } = await join(ana);
    const update = presenceWhere(onApp, (u) => names(u).includes(luis.name));
    await join(luis, replicaUrl);
    expect(names(await update)).toEqual([ana.name, luis.name].sort());
  });
});

describe('límites', () => {
  it('la clave caduca si nadie la actualiza', async () => {
    await join(ana);
    const keys = (await app.redis.keys('*presence:*')).filter((key) => !key.endsWith(':lock'));
    const ttls = await Promise.all(keys.map((key) => app.redis.pttl(key)));
    expect(ttls.length).toBeGreaterThan(0);
    expect(ttls.every((ttl) => ttl > 0 && ttl <= 3_600_000)).toBe(true);
  });
});
