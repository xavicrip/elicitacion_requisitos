import { CursorMovedSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { publishedDiagram } from '../helpers/details';
import {
  closeSockets,
  collect,
  connect,
  nextEvent,
  pause,
  type ClientSocket,
} from '../helpers/realtime';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US3 de la 005 (FR-005; research R6): cursores en coordenadas de imagen, retransmitidos como
// eventos volátiles a la sala del diagrama, sin el emisor y con un límite de 20 por segundo.

let app: FastifyInstance;
let replica: FastifyInstance;
let url: string;
let replicaUrl: string;
let ana: TestUser;
let luis: TestUser;
let outsider: TestUser;
let versionId: string;
const logs: string[] = [];

beforeAll(async () => {
  const { Writable } = await import('node:stream');
  let dbName: string;
  ({ app, dbName } = await buildTestApp('cursors', {
    withAuth: true,
    featureFlags: 'realtime=true',
    logStream: new Writable({
      write(chunk, _encoding, done) {
        logs.push(String(chunk));
        done();
      },
    }),
  }));
  ({ app: replica } = await buildTestApp('cursors', {
    withAuth: true,
    featureFlags: 'realtime=true',
    dbName,
  }));
  url = await app.listen({ port: 0, host: '127.0.0.1' });
  replicaUrl = await replica.listen({ port: 0, host: '127.0.0.1' });
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
  outsider = await registerTestUser(app, 'Marta');
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
    ],
  });
  versionId = (await publishedDiagram(app, authHeaders(ana), projectId)).versionId;
});
afterEach(() => {
  closeSockets();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await replica.close();
  await closeTestApp(app);
});

async function joined(user: TestUser, at = url): Promise<ClientSocket> {
  const socket = await connect(at, user.accessToken);
  const ack = await socket.timeout(2000).emitWithAck('room:join', { versionId });
  expect(ack.ok).toBe(true);
  return socket;
}

describe('cursor:move', () => {
  it('llega a los demás de la sala (también en otra réplica) y no al emisor', async () => {
    const anaSocket = await joined(ana);
    const luisSocket = await joined(luis, replicaUrl);
    const echoed = collect(anaSocket, 'cursor:moved');
    const moved = nextEvent(luisSocket, 'cursor:moved');
    anaSocket.emit('cursor:move', { versionId, x: 120.5, y: 48 });
    const payload = await moved;
    expect(payload).toEqual({ userId: ana.id, x: 120.5, y: 48 });
    expect(CursorMovedSchema.safeParse(payload).success).toBe(true);
    await pause(150);
    expect(echoed).toEqual([]);
  });

  it('se emite como evento volátil', async () => {
    const anaSocket = await joined(ana);
    const luisSocket = await joined(luis);
    const serverSocket = app.io.of('/').sockets.get(anaSocket.id!)!;
    const volatile = vi.spyOn(serverSocket, 'volatile', 'get');
    const moved = nextEvent(luisSocket, 'cursor:moved');
    anaSocket.emit('cursor:move', { versionId, x: 1, y: 2 });
    await moved;
    expect(volatile).toHaveBeenCalled();
  });

  it('más de 20 por segundo se descartan y quedan en el log', async () => {
    const anaSocket = await joined(ana);
    const luisSocket = await joined(luis);
    const received = collect(luisSocket, 'cursor:moved');
    // Espaciados para que el transporte no los descarte por volátiles: 40 en ~0,5 s.
    for (let i = 0; i < 40; i++) {
      anaSocket.emit('cursor:move', { versionId, x: i, y: i });
      await pause(12);
    }
    await pause(200);
    // El límite deja pasar 20; alguno puede perderse por ser volátil, nunca llegan más.
    expect(received.length).toBeLessThanOrEqual(20);
    expect(received.length).toBeGreaterThanOrEqual(15);
    await pause(500);
    const next = nextEvent(luisSocket, 'cursor:moved');
    anaSocket.emit('cursor:move', { versionId, x: 500, y: 500 });
    expect(await next).toEqual({ userId: ana.id, x: 500, y: 500 });
    await vi.waitFor(() =>
      expect(
        logs.some((line) => line.includes('Cursores descartados') && line.includes('"dropped":20')),
      ).toBe(true),
    );
  });

  it('coordenadas inválidas se descartan', async () => {
    const anaSocket = await joined(ana);
    const luisSocket = await joined(luis);
    const received = collect(luisSocket, 'cursor:moved');
    for (const payload of [
      { versionId, x: -1, y: 0 },
      { versionId, x: 'a', y: 0 },
      { versionId, x: Number.NaN, y: 0 },
      { versionId, x: 1 },
      { x: 1, y: 1 },
      null,
    ]) {
      anaSocket.emit('cursor:move', payload as never);
    }
    await pause(300);
    expect(received).toEqual([]);
  });

  it('un socket que no está en la sala no puede emitir en ella', async () => {
    const luisSocket = await joined(luis);
    const received = collect(luisSocket, 'cursor:moved');
    // Marta no es miembro; Ana sí, pero no se ha unido a la sala.
    const martaSocket = await connect(url, outsider.accessToken);
    const anaSocket = await connect(url, ana.accessToken);
    martaSocket.emit('cursor:move', { versionId, x: 1, y: 1 });
    anaSocket.emit('cursor:move', { versionId, x: 2, y: 2 });
    await pause(300);
    expect(received).toEqual([]);
  });
});
