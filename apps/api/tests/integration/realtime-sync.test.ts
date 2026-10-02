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

// US1 de la 005 (FR-001, FR-002, FR-009): los aportes llegan a los miembros conectados al
// proyecto, también al autor, nunca a otro proyecto, y entre instancias de la app.

let app: FastifyInstance;
let replica: FastifyInstance;
let url: string;
let replicaUrl: string;
let ana: TestUser;
let luis: TestUser;
let marta: TestUser;
let projectA: string;
let diagramA: { diagramId: string; versionId: string; keys: Record<string, string> };
let diagramB: { diagramId: string; versionId: string; keys: Record<string, string> };

beforeAll(async () => {
  let dbName: string;
  ({ app, dbName } = await buildTestApp('realtimesync', {
    withAuth: true,
  }));
  // Segunda instancia con la misma base de datos y el mismo Redis (plan, ajuste 5).
  ({ app: replica } = await buildTestApp('realtimesync', {
    withAuth: true,
    dbName,
  }));
  url = await app.listen({ port: 0, host: '127.0.0.1' });
  replicaUrl = await replica.listen({ port: 0, host: '127.0.0.1' });
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
  marta = await registerTestUser(app, 'Marta');
  projectA = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
    ],
  });
  const projectB = await seedProject(app, { status: 'open', members: [[marta, 'admin']] });
  diagramA = await publishedDiagram(app, authHeaders(ana), projectA);
  diagramB = await publishedDiagram(app, authHeaders(marta), projectB);
});
afterEach(() => closeSockets());
afterAll(async () => {
  await replica.close();
  await closeTestApp(app);
});

async function joined(user: TestUser, versionId: string, at = url): Promise<ClientSocket> {
  const socket = await connect(at, user.accessToken);
  const ack = await socket.timeout(2000).emitWithAck('room:join', { versionId });
  expect(ack.ok).toBe(true);
  return socket;
}

describe('reparto a los miembros del proyecto', () => {
  it('un detalle llega a los dos miembros de A (también al autor) y nunca a B', async () => {
    const anaSocket = await joined(ana, diagramA.versionId);
    const luisSocket = await joined(luis, diagramA.versionId);
    const martaSocket = await joined(marta, diagramB.versionId);
    const toMarta = collect(martaSocket, 'detail.created');

    const toAna = nextEvent<{ detail: { id: string }; eventId: string }>(
      anaSocket,
      'detail.created',
    );
    const toLuis = nextEvent<{ detail: { id: string }; eventId: string }>(
      luisSocket,
      'detail.created',
    );
    const response = await createDetail(
      app,
      authHeaders(luis),
      diagramA.diagramId,
      diagramA.keys['Validar pago']!,
    );
    const [forAna, forLuis] = await Promise.all([toAna, toLuis]);
    expect(forAna.detail.id).toBe(response.json().id);
    // El mismo evento para todos: el cliente deduplica por `eventId`.
    expect(forLuis.eventId).toBe(forAna.eventId);
    await pause(200);
    expect(toMarta).toEqual([]);
  });

  it('un socket que no ha hecho room:join no recibe nada', async () => {
    const idle = await connect(url, luis.accessToken);
    const received = collect(idle, 'detail.created');
    await createDetail(app, authHeaders(ana), diagramA.diagramId, diagramA.keys['Emitir factura']!);
    await pause(200);
    expect(received).toEqual([]);
  });

  it('al salir de la sala deja de recibir', async () => {
    const socket = await joined(luis, diagramA.versionId);
    socket.emit('room:leave', { versionId: diagramA.versionId });
    await pause(100);
    const received = collect(socket, 'detail.created');
    await createDetail(app, authHeaders(ana), diagramA.diagramId, diagramA.keys['Enviar pedido']!);
    await pause(200);
    expect(received).toEqual([]);
  });
});

describe('varias instancias (FR-009)', () => {
  it('la escritura en una instancia llega a un cliente conectado a la otra', async () => {
    const onReplica = await joined(luis, diagramA.versionId, replicaUrl);
    const received = nextEvent<{ detail: { id: string } }>(onReplica, 'detail.created');
    const response = await createDetail(
      app,
      authHeaders(ana),
      diagramA.diagramId,
      diagramA.keys['Validar pago']!,
    );
    expect((await received).detail.id).toBe(response.json().id);
  });
});
