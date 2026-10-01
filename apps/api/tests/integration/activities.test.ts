import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogsModel } from '../../src/modules/audit/model';
import { activitiesModel } from '../../src/modules/diagrams/models/activity';
import { projectsModel } from '../../src/modules/projects/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { markPublished, uploadDiagram } from '../helpers/diagrams';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US2: editor de actividades (FR-004–FR-006), con concurrencia optimista (If-Match / rev).

let app: FastifyInstance;
let ana: TestUser;
let pablo: TestUser;
let admin: Record<string, string>;
const bbox = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
/** Requisitos simulados por `key` (los registra la 004). */
const requirements = new Map<string, number>();

beforeAll(async () => {
  ({ app } = await buildTestApp('activities', { withAuth: true }));
  app.registerActivityDependents('requirements', {
    count: async ({ key }) => requirements.get(key) ?? 0,
    remove: async ({ key }) => {
      requirements.delete(key);
    },
  });
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  pablo = await registerTestUser(app, 'Pablo');
  admin = authHeaders(ana);
});

afterAll(() => closeTestApp(app));

async function draftVersion(status: 'draft' | 'open' = 'open') {
  const projectId = await seedProject(app, {
    status,
    members: [
      [ana, 'admin'],
      [pablo, 'participant'],
    ],
  });
  const version = (await uploadDiagram(app, admin, projectId)).json();
  return { projectId, versionId: version.id as string };
}

const create = (versionId: string, payload: Record<string, unknown>, headers = admin) =>
  app.inject({
    method: 'POST',
    url: `/diagram-versions/${versionId}/activities`,
    headers,
    payload: { label: 'Actividad', type: 'action', bbox, ...payload },
  });

const patch = (id: string, rev: number | null, payload: Record<string, unknown>, headers = admin) =>
  app.inject({
    method: 'PATCH',
    url: `/activities/${id}`,
    headers: rev === null ? headers : { ...headers, 'if-match': `"${rev}"` },
    payload,
  });

const remove = (id: string, query = '') =>
  app.inject({ method: 'DELETE', url: `/activities/${id}${query}`, headers: admin });

describe('crear actividades', () => {
  it('rechaza una bbox que sale de la imagen o sin área (400)', async () => {
    const { versionId } = await draftVersion();
    for (const invalid of [
      { x: 0.9, y: 0.1, w: 0.2, h: 0.1 },
      { x: 0.1, y: 0.1, w: 0, h: 0.1 },
    ]) {
      expect((await create(versionId, { bbox: invalid })).statusCode).toBe(400);
    }
  });

  it('solo en versiones en borrador: 409 VERSION_NOT_DRAFT en una publicada', async () => {
    const { versionId } = await draftVersion();
    await markPublished(app, versionId);
    const response = await create(versionId, {});
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'VERSION_NOT_DRAFT' });
  });

  it('funciona en un proyecto en borrador; un Participante recibe 403', async () => {
    const { versionId } = await draftVersion('draft');
    expect((await create(versionId, {})).statusCode).toBe(201);
    expect((await create(versionId, {}, authHeaders(pablo))).statusCode).toBe(403);
  });

  it('un proyecto cerrado es de solo lectura (409 PROJECT_CLOSED)', async () => {
    const { projectId, versionId } = await draftVersion();
    await projectsModel(app.mongo).updateOne({ _id: projectId }, { $set: { status: 'closed' } });
    const response = await create(versionId, {});
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PROJECT_CLOSED' });
  });

  it('next solo admite actividades de la misma versión (400)', async () => {
    const { versionId } = await draftVersion();
    const other = await draftVersion();
    const foreign = (await create(other.versionId, {})).json();
    const response = await create(versionId, { next: [foreign.key] });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('actualiza lastActivityAt y audita activity.created', async () => {
    const { projectId, versionId } = await draftVersion();
    const before = new Date();
    const { id } = (await create(versionId, { label: 'Validar pago' })).json();
    const project = await projectsModel(app.mongo).findById(projectId);
    expect(project!.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(
      await auditLogsModel(app.mongo).exists({ action: 'activity.created', 'entity.id': id }),
    ).toBeTruthy();
  });
});

describe('editar actividades (If-Match)', () => {
  it('sin If-Match → 428', async () => {
    const { versionId } = await draftVersion();
    const { id } = (await create(versionId, {})).json();
    const response = await patch(id, null, { label: 'Otra' });
    expect(response.statusCode).toBe(428);
    expect(response.json()).toMatchObject({ code: 'PRECONDITION_REQUIRED' });
  });

  it('con el rev actual guarda y lo incrementa; con uno desactualizado → 409 con la actual', async () => {
    const { versionId } = await draftVersion();
    const { id } = (await create(versionId, {})).json();
    const first = await patch(id, 0, { bbox: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } });
    expect(first.json()).toMatchObject({ rev: 1, bbox: { x: 0.2 } });

    // Otra pestaña que aún tenía el rev 0.
    const stale = await patch(id, 0, { label: 'Desde otra pestaña' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ id, rev: 1, label: 'Actividad', bbox: { x: 0.2 } });
    expect(stale.headers.etag).toBe('"1"');
  });

  it('next: sin autoenlaces ni actividades de otra versión; con duplicados, 400', async () => {
    const { versionId } = await draftVersion();
    const a = (await create(versionId, { label: 'A' })).json();
    const b = (await create(versionId, { label: 'B' })).json();
    expect((await patch(a.id, 0, { next: [a.key] })).statusCode).toBe(400);
    expect((await patch(a.id, 0, { next: [b.key, b.key] })).statusCode).toBe(400);
    expect((await patch(a.id, 0, { next: ['no-existe'] })).statusCode).toBe(400);
    const linked = await patch(a.id, 0, { next: [b.key] });
    expect(linked.json()).toMatchObject({ next: [b.key], rev: 1 });
  });

  it('un Participante recibe 403; una actividad inexistente, 404', async () => {
    const { versionId } = await draftVersion();
    const { id } = (await create(versionId, {})).json();
    expect((await patch(id, 0, { label: 'X' }, authHeaders(pablo))).statusCode).toBe(403);
    expect((await patch(new Types.ObjectId().toHexString(), 0, { label: 'X' })).statusCode).toBe(
      404,
    );
  });

  it('audita activity.updated con los campos cambiados', async () => {
    const { versionId } = await draftVersion();
    const { id } = (await create(versionId, {})).json();
    await patch(id, 0, { type: 'decision' });
    const audit = await auditLogsModel(app.mongo).findOne({
      action: 'activity.updated',
      'entity.id': id,
    });
    expect(audit?.diff).toMatchObject({ type: 'decision' });
  });
});

describe('eliminar actividades', () => {
  it('retira su key de los next de las demás actividades', async () => {
    const { versionId } = await draftVersion();
    const b = (await create(versionId, { label: 'B' })).json();
    const a = (await create(versionId, { label: 'A', next: [b.key] })).json();
    expect((await remove(b.id)).statusCode).toBe(204);
    const updated = await activitiesModel(app.mongo).findById(a.id).lean();
    expect(updated?.next).toEqual([]);
    expect(await activitiesModel(app.mongo).exists({ _id: b.id })).toBeNull();
  });

  it('con requisitos, exige ?confirm=true (409 con el conteo) y los elimina al confirmar', async () => {
    const { versionId } = await draftVersion();
    const a = (await create(versionId, {})).json();
    requirements.set(a.key, 3);

    const blocked = await remove(a.id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', detailCount: 3 });
    expect(await activitiesModel(app.mongo).exists({ _id: a.id })).toBeTruthy();

    expect((await remove(a.id, '?confirm=true')).statusCode).toBe(204);
    expect(requirements.has(a.key)).toBe(false);
    expect(
      await auditLogsModel(app.mongo).findOne({ action: 'activity.deleted', 'entity.id': a.id }),
    ).toMatchObject({ diff: { dependents: 3 } });
  });

  it('solo en borrador: 409 en una versión publicada', async () => {
    const { versionId } = await draftVersion();
    const a = (await create(versionId, {})).json();
    await markPublished(app, versionId);
    expect((await remove(a.id)).statusCode).toBe(409);
  });
});
