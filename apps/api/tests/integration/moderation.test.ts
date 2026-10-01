import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogsModel } from '../../src/modules/audit/model';
import { projectsModel } from '../../src/modules/projects/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { uploadVersion } from '../helpers/diagrams';
import { createDetail, DETAIL_FLAGS, detailsUrl, publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US5: moderar detalles y reasignar huérfanos (FR-010, edge case de huérfanos, FR-013).

let app: FastifyInstance;
let ana: TestUser;
let luis: TestUser;
const events: string[] = [];

beforeAll(async () => {
  ({ app } = await buildTestApp('moderation', { withAuth: true, featureFlags: DETAIL_FLAGS }));
  await app.ready();
  app.detailEvents.onAny((name) => void events.push(name));
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
});

afterAll(() => closeTestApp(app));

const as = (user: TestUser) => authHeaders(user);

async function setup() {
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
    ],
  });
  const diagram = await publishedDiagram(app, as(ana), projectId);
  const key = diagram.keys['Validar pago']!;
  const create = async () => (await createDetail(app, as(luis), diagram.diagramId, key)).json();
  return { projectId, ...diagram, key, create };
}

const moderate = (id: string, payload: object, user = ana) =>
  app.inject({ method: 'POST', url: `/details/${id}/status`, headers: as(user), payload });

describe('moderar (FR-010)', () => {
  it('validar, descartar con motivo y volver a pendiente; el motivo queda visible', async () => {
    const { create, diagramId, key } = await setup();
    const { id } = await create();
    expect((await moderate(id, { status: 'validated' })).json()).toMatchObject({
      status: 'validated',
      rev: 1,
    });
    expect(
      (await moderate(id, { status: 'discarded', discardReason: 'Fuera de alcance' })).json(),
    ).toMatchObject({ status: 'discarded', discardReason: 'Fuera de alcance' });
    const [forAuthor] = (
      await app.inject({ url: detailsUrl(diagramId, key), headers: as(luis) })
    ).json();
    expect(forAuthor.discardReason).toBe('Fuera de alcance');
    expect((await moderate(id, { status: 'pending' })).json()).toMatchObject({
      status: 'pending',
      discardReason: null,
    });
  });

  it.each([
    ['duplicado → validado', 'duplicate', 'validated'],
    ['descartado → validado', 'discarded', 'validated'],
    ['pendiente → pendiente', 'pending', 'pending'],
  ] as const)('una transición no permitida (%s) → 409', async (_case, from, to) => {
    const { create } = await setup();
    const { id } = await create();
    const other = await create();
    if (from === 'duplicate') await moderate(id, { status: 'duplicate', duplicateOf: other.id });
    if (from === 'discarded')
      await moderate(id, { status: 'discarded', discardReason: 'No aplica' });
    const response = await moderate(id, { status: to });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('duplicado exige un original del mismo proyecto, distinto y que no sea duplicado (422)', async () => {
    const { create } = await setup();
    const { id } = await create();
    const original = await create();
    const third = await create();
    expect((await moderate(id, { status: 'duplicate' })).statusCode).toBe(400);
    expect((await moderate(id, { status: 'duplicate', duplicateOf: id })).statusCode).toBe(422);
    const elsewhere = await setup();
    const foreign = await elsewhere.create();
    expect((await moderate(id, { status: 'duplicate', duplicateOf: foreign.id })).statusCode).toBe(
      422,
    );
    await moderate(third.id, { status: 'duplicate', duplicateOf: original.id });
    expect((await moderate(id, { status: 'duplicate', duplicateOf: third.id })).statusCode).toBe(
      422,
    );
    expect(
      (await moderate(id, { status: 'duplicate', duplicateOf: original.id })).json(),
    ).toMatchObject({
      status: 'duplicate',
      duplicateOf: original.id,
    });
  });

  it('descartar exige un motivo de hasta 500 caracteres (400)', async () => {
    const { create } = await setup();
    const { id } = await create();
    expect((await moderate(id, { status: 'discarded' })).statusCode).toBe(400);
    expect(
      (await moderate(id, { status: 'discarded', discardReason: 'x'.repeat(501) })).statusCode,
    ).toBe(400);
  });

  it('solo el Administrador modera (403); el autor ya no edita un detalle validado', async () => {
    const { create } = await setup();
    const { id } = await create();
    expect((await moderate(id, { status: 'validated' }, luis)).statusCode).toBe(403);
    await moderate(id, { status: 'validated' });
    const edit = await app.inject({
      method: 'PATCH',
      url: `/details/${id}`,
      headers: { ...as(luis), 'if-match': '"1"' },
      payload: { then: 'otra cosa distinta' },
    });
    expect(edit.statusCode).toBe(403);
  });

  it('cada cambio de estado va al historial y se audita y emite', async () => {
    const { create } = await setup();
    const { id } = await create();
    await moderate(id, { status: 'validated' });
    const history = (await app.inject({ url: `/details/${id}/history`, headers: as(ana) })).json();
    expect(history[0]).toMatchObject({ rev: 0, change: 'status', snapshot: { status: 'pending' } });
    expect(
      await auditLogsModel(app.mongo).findOne({ action: 'detail.status_changed', 'entity.id': id }),
    ).toMatchObject({ diff: { status: 'validated' } });
    expect(events).toContain('detail.status_changed');
  });

  it('con el proyecto cerrado no se modera (409 PROJECT_NOT_OPEN)', async () => {
    const { projectId, create } = await setup();
    const { id } = await create();
    await projectsModel(app.mongo).updateOne({ _id: projectId }, { $set: { status: 'closed' } });
    const response = await moderate(id, { status: 'validated' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PROJECT_NOT_OPEN' });
  });
});

describe('huérfanos y reasignación (edge case de la spec)', () => {
  /** La versión 2 elimina "Validar pago" y se publica: sus detalles quedan huérfanos. */
  async function orphanedDetail() {
    const ctx = await setup();
    const detail = await ctx.create();
    const v2 = (await uploadVersion(app, as(ana), ctx.diagramId)).json();
    const copy = (await app.inject({ url: `/diagram-versions/${v2.id}`, headers: as(ana) }))
      .json()
      .activities.find((activity: { key: string }) => activity.key === ctx.key);
    await app.inject({
      method: 'DELETE',
      url: `/activities/${copy.id}?confirm=true`,
      headers: as(ana),
    });
    await app.inject({
      method: 'POST',
      url: `/diagram-versions/${v2.id}/publish`,
      headers: as(ana),
    });
    return { ...ctx, detail };
  }

  it('aparecen en la lista de huérfanos del Administrador', async () => {
    const { projectId, detail } = await orphanedDetail();
    const orphans = (
      await app.inject({ url: `/projects/${projectId}/details/orphans`, headers: as(ana) })
    ).json();
    expect(orphans.map((d: { id: string }) => d.id)).toEqual([detail.id]);
    expect(
      (await app.inject({ url: `/projects/${projectId}/details/orphans`, headers: as(luis) }))
        .statusCode,
    ).toBe(403);
  });

  it('se reasignan a una actividad de la versión publicada; sale de huérfanos y va al historial', async () => {
    const { projectId, diagramId, keys, detail } = await orphanedDetail();
    const reassign = (activityKey: string) =>
      app.inject({
        method: 'POST',
        url: `/details/${detail.id}/reassign`,
        headers: as(ana),
        payload: { diagramId, activityKey },
      });
    expect((await reassign(crypto.randomUUID())).statusCode).toBe(404);
    const response = await reassign(keys['Emitir factura']!);
    expect(response.json()).toMatchObject({ activityKey: keys['Emitir factura'] });
    const orphans = (
      await app.inject({ url: `/projects/${projectId}/details/orphans`, headers: as(ana) })
    ).json();
    expect(orphans).toEqual([]);
    const history = (
      await app.inject({ url: `/details/${detail.id}/history`, headers: as(ana) })
    ).json();
    expect(history[0]).toMatchObject({ change: 'reassign' });
    expect(
      await auditLogsModel(app.mongo).exists({
        action: 'detail.reassigned',
        'entity.id': detail.id,
      }),
    ).toBeTruthy();
  });

  it('un detalle que no es huérfano no se reasigna (409); otro proyecto, 404', async () => {
    const { diagramId, keys, create } = await setup();
    const { id } = await create();
    const response = await app.inject({
      method: 'POST',
      url: `/details/${id}/reassign`,
      headers: as(ana),
      payload: { diagramId, activityKey: keys['Emitir factura'] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'NOT_ORPHAN' });

    const { detail } = await orphanedDetail();
    const elsewhere = await setup();
    const foreign = await app.inject({
      method: 'POST',
      url: `/details/${detail.id}/reassign`,
      headers: as(ana),
      payload: { diagramId: elsewhere.diagramId, activityKey: elsewhere.key },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('con el proyecto cerrado no se reasigna (409)', async () => {
    const { projectId, diagramId, keys, detail } = await orphanedDetail();
    await projectsModel(app.mongo).updateOne(
      { _id: new Types.ObjectId(projectId) },
      { $set: { status: 'closed' } },
    );
    const response = await app.inject({
      method: 'POST',
      url: `/details/${detail.id}/reassign`,
      headers: as(ana),
      payload: { diagramId, activityKey: keys['Emitir factura'] },
    });
    expect(response.statusCode).toBe(409);
  });
});
