import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { createDetail, publishedDiagram } from '../helpers/details';
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

// FR-008 de la 005 (edge cases): retirar a un miembro, cerrar o borrar el proyecto se aplica
// al instante a las sesiones conectadas, en cualquier réplica.

let app: FastifyInstance;
let replica: FastifyInstance;
let url: string;
let replicaUrl: string;
let ana: TestUser;
let luis: TestUser;
let marta: TestUser;

beforeAll(async () => {
  let dbName: string;
  ({ app, dbName } = await buildTestApp('revocation', {
    withAuth: true,
    featureFlags: 'realtime=true',
  }));
  ({ app: replica } = await buildTestApp('revocation', {
    withAuth: true,
    featureFlags: 'realtime=true',
    dbName,
  }));
  url = await app.listen({ port: 0, host: '127.0.0.1' });
  replicaUrl = await replica.listen({ port: 0, host: '127.0.0.1' });
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
  marta = await registerTestUser(app, 'Marta');
});
afterEach(() => closeSockets());
afterAll(async () => {
  await replica.close();
  await closeTestApp(app);
});

/** Proyecto abierto con Ana (Admin), Luis y Marta y un diagrama publicado. */
async function project() {
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
      [marta, 'participant'],
    ],
  });
  return { projectId, ...(await publishedDiagram(app, authHeaders(ana), projectId)) };
}

async function joined(user: TestUser, versionId: string, at = url): Promise<ClientSocket> {
  const socket = await connect(at, user.accessToken);
  const ack = await socket.timeout(2000).emitWithAck('room:join', { versionId });
  expect(ack.ok).toBe(true);
  return socket;
}

const post = (path: string, user: TestUser, payload?: object) =>
  app.inject({ method: 'POST', url: path, headers: authHeaders(user), payload });

describe('retirar o salir', () => {
  it('quien es retirado recibe access:revoked y deja de recibir eventos; los demás no', async () => {
    const { projectId, versionId, diagramId, keys } = await project();
    const luisSocket = await joined(luis, versionId, replicaUrl);
    const martaSocket = await joined(marta, versionId);
    const revoked = nextEvent(luisSocket, 'access:revoked');
    const toMarta = collect(martaSocket, 'access:revoked');

    const removed = await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/members/${luis.id}`,
      headers: authHeaders(ana),
    });
    expect(removed.statusCode).toBe(204);
    expect(await revoked).toEqual({ projectId, reason: 'removed' });

    await pause(100);
    const afterRevocation = collect(luisSocket, 'detail.created');
    const stillMarta = nextEvent(martaSocket, 'detail.created');
    await createDetail(app, authHeaders(ana), diagramId, keys['Validar pago']!);
    await stillMarta;
    await pause(200);
    expect(afterRevocation).toEqual([]);
    expect(toMarta).toEqual([]);
  });

  it('desaparece de la presencia y no puede volver a unirse', async () => {
    const { projectId, versionId } = await project();
    const anaSocket = await joined(ana, versionId);
    const luisSocket = await joined(luis, versionId, replicaUrl);
    const gone = new Promise<void>((resolve) => {
      anaSocket.on('presence:update', ({ entries }) => {
        if (!entries.some((entry) => entry.userId === luis.id)) resolve();
      });
    });
    await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/members/${luis.id}`,
      headers: authHeaders(ana),
    });
    await gone;
    expect(await luisSocket.timeout(2000).emitWithAck('room:join', { versionId })).toEqual({
      ok: false,
      code: 'not_found',
    });
    // Ni su selección llega ya a la sala.
    const updates = collect(anaSocket, 'presence:update');
    luisSocket.emit('presence:select', { versionId, activityKey: 'k1' });
    await pause(200);
    expect(updates).toEqual([]);
  });

  it('salir del proyecto revoca igual', async () => {
    const { projectId, versionId } = await project();
    const martaSocket = await joined(marta, versionId);
    const revoked = nextEvent(martaSocket, 'access:revoked');
    await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/members/${marta.id}`,
      headers: authHeaders(marta),
    });
    expect(await revoked).toEqual({ projectId, reason: 'removed' });
  });
});

describe('estado del proyecto', () => {
  it('cerrar → project:closed y reabrir → project:reopened, a toda la sala', async () => {
    const { projectId, versionId } = await project();
    const luisSocket = await joined(luis, versionId, replicaUrl);
    const closed = nextEvent(luisSocket, 'project:closed');
    expect((await post(`/projects/${projectId}/status`, ana, { action: 'close' })).statusCode).toBe(
      200,
    );
    expect(await closed).toEqual({ projectId });
    const reopened = nextEvent(luisSocket, 'project:reopened');
    await post(`/projects/${projectId}/status`, ana, { action: 'reopen' });
    expect(await reopened).toEqual({ projectId });
  });

  it('borrar el proyecto → access:revoked con reason deleted a todos', async () => {
    const { projectId, versionId } = await project();
    const sockets = [await joined(luis, versionId), await joined(marta, versionId, replicaUrl)];
    const revoked = sockets.map((socket) => nextEvent(socket, 'access:revoked'));
    const name = (
      await app.inject({ url: `/projects/${projectId}`, headers: authHeaders(ana) })
    ).json().name;
    await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}`,
      headers: authHeaders(ana),
      payload: { confirmName: name },
    });
    for (const payload of await Promise.all(revoked)) {
      expect(payload).toEqual({ projectId, reason: 'deleted' });
    }
  });
});
