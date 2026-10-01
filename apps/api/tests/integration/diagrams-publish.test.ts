import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogsModel } from '../../src/modules/audit/model';
import { activitiesModel } from '../../src/modules/diagrams/models/activity';
import { diagramsModel } from '../../src/modules/diagrams/models/diagram';
import { versionsModel } from '../../src/modules/diagrams/models/version';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { uploadDiagram, uploadVersion } from '../helpers/diagrams';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US3: publicar el espacio de trabajo y versiones nuevas (FR-007, FR-008).

let app: FastifyInstance;
let ana: TestUser;
let admin: Record<string, string>;
let participant: Record<string, string>;
const bbox = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };

beforeAll(async () => {
  ({ app } = await buildTestApp('diagramspublish', {
    withAuth: true,
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  const pablo = await registerTestUser(app, 'Pablo');
  admin = authHeaders(ana);
  participant = authHeaders(pablo);
  projectMembers = [
    [ana, 'admin'],
    [pablo, 'participant'],
  ];
});

afterAll(() => closeTestApp(app));

let projectMembers: Array<[TestUser, 'admin' | 'participant']>;

async function diagramWithDraft() {
  const projectId = await seedProject(app, { status: 'open', members: projectMembers });
  const version = (await uploadDiagram(app, admin, projectId)).json();
  return { projectId, diagramId: version.diagramId as string, versionId: version.id as string };
}

const addActivity = (versionId: string, payload: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: `/diagram-versions/${versionId}/activities`,
    headers: admin,
    payload: { label: 'Validar pago', type: 'action', bbox, ...payload },
  });

const publish = (versionId: string, headers = admin) =>
  app.inject({ method: 'POST', url: `/diagram-versions/${versionId}/publish`, headers });

describe('publicar (FR-007)', () => {
  it('sin actividades → 422 NO_ACTIVITIES con la explicación', async () => {
    const { versionId } = await diagramWithDraft();
    const response = await publish(versionId);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'NO_ACTIVITIES' });
    expect(response.json().message).toMatch(/al menos una actividad/);
  });

  it('deja la versión publicada y actualiza publishedVersionId del diagrama', async () => {
    const { diagramId, versionId } = await diagramWithDraft();
    await addActivity(versionId);
    const response = await publish(versionId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'published' });
    const diagram = await diagramsModel(app.mongo).findById(diagramId).lean();
    expect(diagram?.publishedVersionId?.toHexString()).toBe(versionId);
  });

  it('una versión ya publicada no se vuelve a publicar (409 VERSION_NOT_DRAFT)', async () => {
    const { versionId } = await diagramWithDraft();
    await addActivity(versionId);
    await publish(versionId);
    const again = await publish(versionId);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'VERSION_NOT_DRAFT' });
  });

  it('publicar la versión 2 archiva la 1', async () => {
    const { diagramId, versionId: v1 } = await diagramWithDraft();
    await addActivity(v1);
    await publish(v1);
    const v2 = (await uploadVersion(app, admin, diagramId)).json().id as string;
    expect((await publish(v2)).statusCode).toBe(200);

    const statuses = await versionsModel(app.mongo)
      .find({ diagramId: new Types.ObjectId(diagramId) })
      .sort({ number: 1 })
      .lean();
    expect(statuses.map((version) => version.status)).toEqual(['archived', 'published']);
    const diagram = await diagramsModel(app.mongo).findById(diagramId).lean();
    expect(diagram?.publishedVersionId?.toHexString()).toBe(v2);
  });

  it('dos publicaciones simultáneas de la misma versión: una responde 200 y la otra 409', async () => {
    const { diagramId, versionId } = await diagramWithDraft();
    await addActivity(versionId);
    const responses = await Promise.all([publish(versionId), publish(versionId)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(
      await versionsModel(app.mongo).countDocuments({
        diagramId: new Types.ObjectId(diagramId),
        status: 'published',
      }),
    ).toBe(1);
  });

  it('un Participante recibe 403', async () => {
    const { versionId } = await diagramWithDraft();
    await addActivity(versionId);
    expect((await publish(versionId, participant)).statusCode).toBe(403);
  });

  it('audita diagram.published con el número de versión', async () => {
    const { versionId } = await diagramWithDraft();
    await addActivity(versionId);
    await publish(versionId);
    const audit = await auditLogsModel(app.mongo).findOne({
      action: 'diagram.published',
      'entity.id': versionId,
    });
    expect(audit?.diff).toMatchObject({ number: 1 });
  });
});

describe('lo que ve un Participante (US3 escenario 2)', () => {
  it('solo lista diagramas publicados y abre su versión publicada; un borrador → 404', async () => {
    const { projectId, versionId } = await diagramWithDraft();
    const list = async () =>
      (await app.inject({ url: `/projects/${projectId}/diagrams`, headers: participant })).json();
    expect(await list()).toEqual([]);
    expect(
      (await app.inject({ url: `/diagram-versions/${versionId}`, headers: participant }))
        .statusCode,
    ).toBe(404);

    await addActivity(versionId);
    await publish(versionId);
    expect(await list()).toEqual([
      expect.not.objectContaining({ draftVersionId: expect.anything() }),
    ]);
    expect((await list())[0]).toMatchObject({ publishedVersionId: versionId });
    expect(
      (await app.inject({ url: `/diagram-versions/${versionId}`, headers: participant }))
        .statusCode,
    ).toBe(200);
  });

  it('sigue viendo la versión 1 hasta que se publica la 2', async () => {
    const { projectId, diagramId, versionId: v1 } = await diagramWithDraft();
    await addActivity(v1);
    await publish(v1);
    const v2 = (await uploadVersion(app, admin, diagramId)).json().id as string;

    const shown = async () =>
      (await app.inject({ url: `/projects/${projectId}/diagrams`, headers: participant })).json()[0]
        .publishedVersionId;
    expect(await shown()).toBe(v1);
    expect(
      (await app.inject({ url: `/diagram-versions/${v2}`, headers: participant })).statusCode,
    ).toBe(404);

    await publish(v2);
    expect(await shown()).toBe(v2);
  });
});

describe('versión nueva (FR-008)', () => {
  it('copia las actividades de la última versión con la misma key, nuevos ids y rev 0', async () => {
    const { diagramId, versionId: v1 } = await diagramWithDraft();
    const b = (await addActivity(v1, { label: 'Emitir factura' })).json();
    const a = (
      await addActivity(v1, { label: 'Validar pago', type: 'decision', next: [b.key] })
    ).json();
    // Una edición deja el rev de "Validar pago" en 1.
    await app.inject({
      method: 'PATCH',
      url: `/activities/${a.id}`,
      headers: { ...admin, 'if-match': '"0"' },
      payload: { bbox: { x: 0.2, y: 0.2, w: 0.2, h: 0.1 } },
    });
    await publish(v1);

    const v2 = (await uploadVersion(app, admin, diagramId)).json().id as string;
    const copied = (await app.inject({ url: `/diagram-versions/${v2}`, headers: admin })).json()
      .activities as Array<Record<string, unknown>>;
    expect(copied).toHaveLength(2);
    const byKey = new Map(copied.map((activity) => [activity.key, activity]));
    expect(byKey.get(a.key)).toMatchObject({
      label: 'Validar pago',
      type: 'decision',
      rev: 0,
      next: [b.key],
      bbox: { x: 0.2, y: 0.2, w: 0.2, h: 0.1 },
    });
    expect(byKey.get(a.key)?.id).not.toBe(a.id);
    expect(byKey.get(b.key)).toMatchObject({ label: 'Emitir factura', rev: 0 });

    // Las de la versión 1 no cambian.
    expect(
      await activitiesModel(app.mongo).countDocuments({ versionId: new Types.ObjectId(v1) }),
    ).toBe(2);
  });
});
