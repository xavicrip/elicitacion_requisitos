import { RELAYED_EVENT_SCHEMAS, type RelayedEventName } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { createDetail, publishedDiagram } from '../helpers/details';
import { uploadVersion } from '../helpers/diagrams';
import { closeSockets, connect, nextEvent, type ClientSocket } from '../helpers/realtime';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Constitución III: prueba de contrato de todos los eventos de
// specs/005-colaboracion-tiempo-real/contracts/socket-events.md. US2, US4 y US3 añaden aquí
// los suyos (presencia, revocación y cursores).

let app: FastifyInstance;
let url: string;
let ana: TestUser;
let luis: TestUser;
let projectId: string;
let diagram: { diagramId: string; versionId: string; keys: Record<string, string> };

beforeAll(async () => {
  ({ app } = await buildTestApp('socketcontract', {
    withAuth: true,
    featureFlags: 'realtime=true',
  }));
  url = await app.listen({ port: 0, host: '127.0.0.1' });
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
  projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
    ],
  });
  diagram = await publishedDiagram(app, authHeaders(ana), projectId);
});
afterEach(() => closeSockets());
afterAll(() => closeTestApp(app));

async function listener(): Promise<ClientSocket> {
  const socket = await connect(url, luis.accessToken);
  expect(
    await socket.timeout(2000).emitWithAck('room:join', { versionId: diagram.versionId }),
  ).toMatchObject({ ok: true });
  return socket;
}

/** Espera el evento mientras ocurre la acción y lo valida contra su esquema de `packages/shared`. */
async function expectEvent(socket: ClientSocket, name: RelayedEventName, action: () => unknown) {
  const received = nextEvent<Record<string, unknown>>(socket, name);
  await action();
  const payload = await received;
  const parsed = RELAYED_EVENT_SCHEMAS[name].safeParse(payload);
  expect(parsed.error?.issues ?? [], name).toEqual([]);
  expect(payload.eventId).toMatch(/^[0-9a-f-]{36}$/);
  expect(Date.parse(payload.at as string)).not.toBeNaN();
  return payload;
}

const inject = (
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  user: TestUser,
  payload?: object,
  headers: Record<string, string> = {},
) => app.inject({ method, url: path, headers: { ...authHeaders(user), ...headers }, payload });

describe('eventos de dominio retransmitidos (servidor → cliente)', () => {
  it('detalles, votos y comentarios, sin datos calculados por usuario', async () => {
    const socket = await listener();
    const key = diagram.keys['Validar pago']!;
    const created = await expectEvent(socket, 'detail.created', () =>
      createDetail(app, authHeaders(ana), diagram.diagramId, key),
    );
    const detailId = (created.detail as { id: string }).id;

    await expectEvent(socket, 'detail.updated', () =>
      inject(
        'PATCH',
        `/details/${detailId}`,
        ana,
        { then: 'confirma el pago enseguida' },
        {
          'if-match': '"0"',
        },
      ),
    );
    await expectEvent(socket, 'vote.changed', () =>
      inject('PUT', `/details/${detailId}/vote`, luis),
    );
    const comment = await expectEvent(socket, 'comment.created', () =>
      inject('POST', `/details/${detailId}/comments`, ana, { text: '¿Y PayPal?' }),
    );
    const commentId = (comment.comment as { id: string }).id;
    await expectEvent(socket, 'comment.updated', () =>
      inject('PATCH', `/comments/${commentId}`, ana, { text: '¿Y Bizum?' }),
    );
    await expectEvent(socket, 'comment.deleted', () =>
      inject('DELETE', `/comments/${commentId}`, ana),
    );
    await expectEvent(socket, 'detail.status_changed', () =>
      inject('POST', `/details/${detailId}/status`, ana, { status: 'validated' }),
    );
    await expectEvent(socket, 'detail.deleted', () =>
      inject('DELETE', `/details/${detailId}`, ana),
    );
  });

  it('detail.reassigned de un huérfano', async () => {
    const socket = await listener();
    const orphan = (
      await createDetail(app, authHeaders(ana), diagram.diagramId, diagram.keys['Validar pago']!)
    ).json();
    await app.mongo
      .collection('details')
      .updateOne(
        { _id: new Types.ObjectId(orphan.id) },
        { $set: { activityKey: '11111111-1111-4111-8111-111111111111' } },
      );
    await expectEvent(socket, 'detail.reassigned', () =>
      inject('POST', `/details/${orphan.id}/reassign`, ana, {
        diagramId: diagram.diagramId,
        activityKey: diagram.keys['Emitir factura'],
      }),
    );
  });

  it('diagram.published al publicar una versión nueva', async () => {
    const socket = await listener();
    const version = (await uploadVersion(app, authHeaders(ana), diagram.diagramId)).json();
    const published = await expectEvent(socket, 'diagram.published', () =>
      inject('POST', `/diagram-versions/${version.id}/publish`, ana),
    );
    expect(published).toMatchObject({ diagramId: diagram.diagramId, versionId: version.id });
  });
});

describe('eventos del cliente con un payload inválido', () => {
  it('room:join y auth:refresh responden con un ack de error', async () => {
    const socket = await connect(url, luis.accessToken);
    for (const payload of [{}, { versionId: 3 }, null]) {
      expect(await socket.timeout(2000).emitWithAck('room:join', payload as never)).toEqual({
        ok: false,
        code: 'invalid',
      });
    }
    expect(await socket.timeout(2000).emitWithAck('auth:refresh', { token: 3 } as never)).toEqual({
      ok: false,
    });
  });
});
