import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogsModel } from '../../src/modules/audit/model';
import { commentsModel } from '../../src/modules/details/models/comment';
import { detailsModel } from '../../src/modules/details/models/detail';
import { historyModel } from '../../src/modules/details/models/history';
import { votesModel } from '../../src/modules/details/models/vote';
import { projectsModel } from '../../src/modules/projects/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { createDetail, DETAIL_FLAGS, detailsUrl, publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US2: editar y eliminar detalles (FR-005–FR-007).

let app: FastifyInstance;
let ana: TestUser;
let luis: TestUser;
let marta: TestUser;
const events: string[] = [];

beforeAll(async () => {
  ({ app } = await buildTestApp('detailsedit', { withAuth: true, featureFlags: DETAIL_FLAGS }));
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

const patch = (id: string, user: TestUser, rev: number | null, payload: object) =>
  app.inject({
    method: 'PATCH',
    url: `/details/${id}`,
    headers: rev === null ? as(user) : { ...as(user), 'if-match': `"${rev}"` },
    payload,
  });
const remove = (id: string, user: TestUser) =>
  app.inject({ method: 'DELETE', url: `/details/${id}`, headers: as(user) });

describe('editar (FR-005, FR-007)', () => {
  it('el autor edita su detalle pendiente; las etiquetas se normalizan', async () => {
    const { detail } = await setup();
    const response = await patch(detail.id, luis, 0, {
      then: 'el sistema confirma el pago en 3 segundos',
      tags: [' Pagos '],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      then: 'el sistema confirma el pago en 3 segundos',
      tags: ['pagos'],
      rev: 1,
    });
  });

  it('otro Participante no puede editarlo ni eliminarlo (403)', async () => {
    const { detail } = await setup();
    expect((await patch(detail.id, marta, 0, { then: 'otra cosa distinta' })).statusCode).toBe(403);
    expect((await remove(detail.id, marta)).statusCode).toBe(403);
  });

  it('un detalle validado solo lo edita el Administrador', async () => {
    const { detail } = await setup();
    await detailsModel(app.mongo).updateOne({ _id: detail.id }, { $set: { status: 'validated' } });
    expect((await patch(detail.id, luis, 0, { then: 'otra cosa distinta' })).statusCode).toBe(403);
    expect((await patch(detail.id, ana, 0, { then: 'otra cosa distinta' })).statusCode).toBe(200);
  });

  it('sin If-Match → 428; con un rev desactualizado → 409 con el detalle actual', async () => {
    const { detail } = await setup();
    expect((await patch(detail.id, luis, null, { then: 'otra cosa distinta' })).statusCode).toBe(
      428,
    );
    await patch(detail.id, ana, 0, { then: 'la versión de Ana' });
    const stale = await patch(detail.id, luis, 0, { then: 'la versión de Luis' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ id: detail.id, rev: 1, then: 'la versión de Ana' });
    expect(stale.headers.etag).toBe('"1"');
  });

  it('una petición inválida → 400 por campo; un detalle inexistente → 404', async () => {
    const { detail } = await setup();
    const invalid = await patch(detail.id, luis, 0, { when: 'abc' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().fields).toHaveProperty('when');
    expect(
      (await patch(new Types.ObjectId().toHexString(), luis, 0, { then: 'xxxxxx' })).statusCode,
    ).toBe(404);
  });

  it('cada edición guarda la versión anterior en el historial (FR-006)', async () => {
    const { detail } = await setup();
    await patch(detail.id, luis, 0, { then: 'segunda versión del resultado' });
    await patch(detail.id, ana, 1, { priority: 'must' });
    const history = (
      await app.inject({ url: `/details/${detail.id}/history`, headers: as(marta) })
    ).json();
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      rev: 1,
      change: 'edit',
      editedBy: { id: ana.id, name: ana.name },
      snapshot: { then: 'segunda versión del resultado', priority: null },
    });
    expect(history[1]).toMatchObject({
      rev: 0,
      editedBy: { id: luis.id },
      snapshot: { then: detail.then },
    });
  });

  it('proyecto cerrado → 409 PROJECT_NOT_OPEN', async () => {
    const { projectId, detail } = await setup();
    await projectsModel(app.mongo).updateOne({ _id: projectId }, { $set: { status: 'closed' } });
    const response = await patch(detail.id, luis, 0, { then: 'otra cosa distinta' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PROJECT_NOT_OPEN' });
  });

  it('audita detail.updated, emite el evento y actualiza lastActivityAt', async () => {
    const { projectId, detail } = await setup();
    const before = new Date();
    await patch(detail.id, luis, 0, { then: 'otra cosa distinta' });
    expect(
      await auditLogsModel(app.mongo).exists({ action: 'detail.updated', 'entity.id': detail.id }),
    ).toBeTruthy();
    expect(events).toContain('detail.updated');
    const project = await projectsModel(app.mongo).findById(projectId);
    expect(project!.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

describe('eliminar', () => {
  it('borra el detalle con sus votos, comentarios e historial; audita y emite', async () => {
    const { projectId, detail } = await setup();
    const ref = {
      detailId: new Types.ObjectId(detail.id),
      projectId: new Types.ObjectId(projectId),
    };
    await votesModel(app.mongo).create({ ...ref, userId: new Types.ObjectId(marta.id) });
    await commentsModel(app.mongo).create({
      ...ref,
      authorId: new Types.ObjectId(marta.id),
      text: 'ok',
    });
    await patch(detail.id, luis, 0, { then: 'otra cosa distinta' });

    expect((await remove(detail.id, luis)).statusCode).toBe(204);
    expect(await detailsModel(app.mongo).exists({ _id: detail.id })).toBeNull();
    const filter = { detailId: ref.detailId };
    expect(await votesModel(app.mongo).countDocuments(filter)).toBe(0);
    expect(await commentsModel(app.mongo).countDocuments(filter)).toBe(0);
    expect(await historyModel(app.mongo).countDocuments(filter)).toBe(0);
    expect(
      await auditLogsModel(app.mongo).exists({ action: 'detail.deleted', 'entity.id': detail.id }),
    ).toBeTruthy();
    expect(events).toContain('detail.deleted');
  });

  it('el Administrador elimina cualquier detalle', async () => {
    const { detail } = await setup();
    expect((await remove(detail.id, ana)).statusCode).toBe(204);
  });
});

describe('miembros retirados', () => {
  it('sus detalles se conservan con su nombre', async () => {
    const { projectId, diagramId, key } = await setup();
    await projectsModel(app.mongo).updateOne(
      { _id: projectId },
      { $pull: { members: { userId: new Types.ObjectId(luis.id) } } },
    );
    const [detail] = (
      await app.inject({ url: detailsUrl(diagramId, key), headers: as(marta) })
    ).json();
    expect(detail.author).toEqual({ id: luis.id, name: luis.name });
  });
});
