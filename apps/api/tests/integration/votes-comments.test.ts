import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogsModel } from '../../src/modules/audit/model';
import { detailsModel } from '../../src/modules/details/models/detail';
import { projectsModel } from '../../src/modules/projects/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { createDetail, DETAIL_FLAGS, detailsUrl, publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US4: votar y comentar detalles (FR-008, FR-009).

let app: FastifyInstance;
let ana: TestUser;
let luis: TestUser;
let marta: TestUser;
const events: string[] = [];

beforeAll(async () => {
  ({ app } = await buildTestApp('votescomments', { withAuth: true, featureFlags: DETAIL_FLAGS }));
  await app.ready();
  app.detailEvents.onAny((name) => void events.push(name));
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
  marta = await registerTestUser(app, 'Marta');
});

afterAll(() => closeTestApp(app));

const as = (user: TestUser) => authHeaders(user);

async function setup() {
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
      [marta, 'participant'],
    ],
  });
  const diagram = await publishedDiagram(app, as(ana), projectId);
  const key = diagram.keys['Validar pago']!;
  const detail = (await createDetail(app, as(luis), diagram.diagramId, key)).json();
  return { projectId, diagramId: diagram.diagramId, key, detail };
}

const vote = (id: string, user: TestUser) =>
  app.inject({ method: 'PUT', url: `/details/${id}/vote`, headers: as(user) });
const unvote = (id: string, user: TestUser) =>
  app.inject({ method: 'DELETE', url: `/details/${id}/vote`, headers: as(user) });
const comment = (id: string, user: TestUser, text: string) =>
  app.inject({
    method: 'POST',
    url: `/details/${id}/comments`,
    headers: as(user),
    payload: { text },
  });

describe('votos (FR-008)', () => {
  it('votar es idempotente y retirar el voto vuelve a 0', async () => {
    const { detail } = await setup();
    expect((await vote(detail.id, marta)).json()).toEqual({ voteCount: 1, votedByMe: true });
    expect((await vote(detail.id, marta)).json()).toEqual({ voteCount: 1, votedByMe: true });
    expect((await vote(detail.id, ana)).json()).toEqual({ voteCount: 2, votedByMe: true });
    expect((await unvote(detail.id, marta)).json()).toEqual({ voteCount: 1, votedByMe: false });
    expect((await unvote(detail.id, marta)).json()).toEqual({ voteCount: 1, votedByMe: false });
  });

  it('el contador es exacto con votos simultáneos del mismo miembro (índice único)', async () => {
    const { detail } = await setup();
    await Promise.all(Array.from({ length: 5 }, () => vote(detail.id, marta)));
    const stored = await detailsModel(app.mongo).findById(detail.id).lean();
    expect(stored?.voteCount).toBe(1);
  });

  it('no se puede votar el detalle propio (403)', async () => {
    const { detail } = await setup();
    const response = await vote(detail.id, luis);
    expect(response.statusCode).toBe(403);
  });

  it('un duplicado o un descartado no se vota (409), pero se puede retirar un voto', async () => {
    const { detail } = await setup();
    await vote(detail.id, marta);
    await detailsModel(app.mongo).updateOne(
      { _id: detail.id },
      { $set: { status: 'discarded', discardReason: 'Fuera de alcance' } },
    );
    const blocked = await vote(detail.id, ana);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'VOTE_NOT_ALLOWED' });
    expect((await unvote(detail.id, marta)).json()).toEqual({ voteCount: 0, votedByMe: false });
  });

  it('el detalle muestra votedByMe a quien votó', async () => {
    const { diagramId, key, detail } = await setup();
    await vote(detail.id, marta);
    const [listed] = (
      await app.inject({ url: detailsUrl(diagramId, key), headers: as(marta) })
    ).json();
    expect(listed).toMatchObject({ voteCount: 1, votedByMe: true });
  });

  it('proyecto cerrado → 409 PROJECT_NOT_OPEN; emite vote.changed y audita', async () => {
    const { projectId, detail } = await setup();
    await vote(detail.id, marta);
    expect(events).toContain('vote.changed');
    expect(
      await auditLogsModel(app.mongo).exists({ action: 'vote.changed', 'entity.id': detail.id }),
    ).toBeTruthy();
    await projectsModel(app.mongo).updateOne({ _id: projectId }, { $set: { status: 'closed' } });
    const response = await unvote(detail.id, marta);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PROJECT_NOT_OPEN' });
  });
});

describe('comentarios (FR-009)', () => {
  it('se publican con autor y fecha, en orden, y mantienen commentCount', async () => {
    const { diagramId, key, detail } = await setup();
    await comment(detail.id, marta, ' ¿Aplica también a PayPal? ');
    await comment(detail.id, luis, 'Sí, a cualquier medio de pago');
    const list = (
      await app.inject({ url: `/details/${detail.id}/comments`, headers: as(ana) })
    ).json();
    expect(
      list.map((item: { text: string; author: { name: string } }) => [item.text, item.author.name]),
    ).toEqual([
      ['¿Aplica también a PayPal?', marta.name],
      ['Sí, a cualquier medio de pago', luis.name],
    ]);
    const [listed] = (
      await app.inject({ url: detailsUrl(diagramId, key), headers: as(ana) })
    ).json();
    expect(listed.commentCount).toBe(2);
  });

  it('texto vacío o de más de 1 000 caracteres → 400; el HTML se guarda literal', async () => {
    const { detail } = await setup();
    expect((await comment(detail.id, marta, '  ')).statusCode).toBe(400);
    expect((await comment(detail.id, marta, 'x'.repeat(1001))).statusCode).toBe(400);
    const html = (await comment(detail.id, marta, '<img src=x onerror=alert(1)>')).json();
    expect(html.text).toBe('<img src=x onerror=alert(1)>');
  });

  it('cada uno edita sus comentarios; los elimina su autor o un Administrador', async () => {
    const { detail } = await setup();
    const own = (await comment(detail.id, marta, 'primera versión')).json();
    const edit = (user: TestUser) =>
      app.inject({
        method: 'PATCH',
        url: `/comments/${own.id}`,
        headers: as(user),
        payload: { text: 'segunda versión' },
      });
    expect((await edit(luis)).statusCode).toBe(403);
    expect((await edit(ana)).statusCode).toBe(403);
    const edited = await edit(marta);
    expect(edited.json()).toMatchObject({ text: 'segunda versión', editedAt: expect.any(String) });

    const remove = (id: string, user: TestUser) =>
      app.inject({ method: 'DELETE', url: `/comments/${id}`, headers: as(user) });
    expect((await remove(own.id, luis)).statusCode).toBe(403);
    expect((await remove(own.id, ana)).statusCode).toBe(204);
    expect((await detailsModel(app.mongo).findById(detail.id).lean())?.commentCount).toBe(0);
  });

  it('los permisos de cada comentario dependen de quien consulta', async () => {
    const { detail } = await setup();
    await comment(detail.id, marta, 'un comentario');
    const forMarta = (
      await app.inject({ url: `/details/${detail.id}/comments`, headers: as(marta) })
    ).json();
    expect(forMarta[0].permissions).toEqual({ canEdit: true, canDelete: true });
    const forLuis = (
      await app.inject({ url: `/details/${detail.id}/comments`, headers: as(luis) })
    ).json();
    expect(forLuis[0].permissions).toEqual({ canEdit: false, canDelete: false });
    const forAna = (
      await app.inject({ url: `/details/${detail.id}/comments`, headers: as(ana) })
    ).json();
    expect(forAna[0].permissions).toEqual({ canEdit: false, canDelete: true });
  });

  it('se puede comentar un detalle descartado; con el proyecto cerrado, no (409)', async () => {
    const { projectId, detail } = await setup();
    await detailsModel(app.mongo).updateOne(
      { _id: detail.id },
      { $set: { status: 'discarded', discardReason: 'Fuera de alcance' } },
    );
    expect((await comment(detail.id, marta, '¿Por qué se descartó?')).statusCode).toBe(201);
    await projectsModel(app.mongo).updateOne({ _id: projectId }, { $set: { status: 'closed' } });
    expect((await comment(detail.id, marta, 'otro comentario')).statusCode).toBe(409);
  });

  it('audita y emite los eventos de comentarios', async () => {
    const { detail } = await setup();
    const created = (await comment(detail.id, marta, 'un comentario')).json();
    await app.inject({
      method: 'PATCH',
      url: `/comments/${created.id}`,
      headers: as(marta),
      payload: { text: 'editado' },
    });
    await app.inject({ method: 'DELETE', url: `/comments/${created.id}`, headers: as(marta) });
    expect(events).toEqual(
      expect.arrayContaining(['comment.created', 'comment.updated', 'comment.deleted']),
    );
    expect(
      await auditLogsModel(app.mongo).exists({
        action: 'comment.deleted',
        'entity.id': created.id,
      }),
    ).toBeTruthy();
  });
});
