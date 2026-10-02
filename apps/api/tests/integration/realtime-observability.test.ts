import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { publishedDiagram } from '../helpers/details';
import { closeSockets, connect, pause } from '../helpers/realtime';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Constitución VI en la 005: conexiones y desconexiones por réplica, latencia del ping y
// eventos descartados, en logs JSON y sin tokens.

let app: FastifyInstance;
let url: string;
let ana: TestUser;
let versionId: string;
const logs: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  const { Writable } = await import('node:stream');
  ({ app } = await buildTestApp('realtimeobs', {
    withAuth: true,
    realtime: { replicaId: 'replica-a', pingIntervalMs: 100 },
    logStream: new Writable({
      write(chunk, _encoding, done) {
        for (const line of String(chunk).split('\n').filter(Boolean)) logs.push(JSON.parse(line));
        done();
      },
    }),
  }));
  url = await app.listen({ port: 0, host: '127.0.0.1' });
  ana = await registerTestUser(app, 'Ana');
  const projectId = await seedProject(app, { status: 'open', members: [[ana, 'admin']] });
  versionId = (await publishedDiagram(app, authHeaders(ana), projectId)).versionId;
});
afterEach(() => closeSockets());
afterAll(() => closeTestApp(app));

const find = (event: string) => logs.filter((line) => line.event === event);

describe('observabilidad del socket', () => {
  it('registra la conexión y la desconexión con réplica, duración y latencia del ping', async () => {
    const socket = await connect(url, ana.accessToken);
    const id = socket.id;
    await vi.waitFor(() =>
      expect(find('socket.connected').find((line) => line.socketId === id)).toMatchObject({
        userId: ana.id,
        replica: 'replica-a',
        connections: expect.any(Number),
      }),
    );
    await pause(350);
    socket.close();
    await vi.waitFor(() => {
      const line = find('socket.disconnected').find((entry) => entry.socketId === id);
      expect(line).toMatchObject({
        userId: ana.id,
        replica: 'replica-a',
        reason: 'client namespace disconnect',
        durationMs: expect.any(Number),
        pingMs: expect.any(Number),
        pingMaxMs: expect.any(Number),
      });
    });
  });

  it('registra los descartes por límite y por payload inválido', async () => {
    const socket = await connect(url, ana.accessToken);
    await socket.timeout(2000).emitWithAck('room:join', { versionId });
    for (let i = 0; i < 15; i++) {
      socket.emit('presence:select', { versionId, activityKey: `k${i}` });
    }
    socket.emit('cursor:move', { versionId, x: -1, y: 0 });
    await vi.waitFor(() => {
      expect(find('presence:select').some((line) => line.socketId === socket.id)).toBe(true);
      expect(
        logs.some((line) => line.event === 'cursor:move' && String(line.msg).includes('inválido')),
      ).toBe(true);
    });
  });

  it('nunca escribe el token en el log', async () => {
    const socket = await connect(url, ana.accessToken);
    socket.close();
    await pause(100);
    expect(JSON.stringify(logs)).not.toContain(ana.accessToken);
  });
});
