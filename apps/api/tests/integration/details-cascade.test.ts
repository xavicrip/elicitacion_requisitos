import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commentsModel } from '../../src/modules/details/models/comment';
import { detailsModel } from '../../src/modules/details/models/detail';
import { historyModel } from '../../src/modules/details/models/history';
import { votesModel } from '../../src/modules/details/models/vote';
import { projectsModel, type Project } from '../../src/modules/projects/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { markPublished, uploadDiagram, uploadVersion } from '../helpers/diagrams';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Plan de la 004, ajustes 4 y 5: cascada del proyecto y dependiente de actividades que solo cuenta.

let app: FastifyInstance;
let ana: TestUser;
const failuresLeft = new Map<string, number>();

beforeAll(async () => {
  ({ app } = await buildTestApp('detailscascade', {
    withAuth: true,
    deletion: { attempts: 3, backoffMs: 10 },
  }));
  app.registerProjectCascade('fallo-posterior', async (projectId) => {
    const left = failuresLeft.get(projectId.toHexString()) ?? 0;
    if (left > 0) {
      failuresLeft.set(projectId.toHexString(), left - 1);
      throw new Error('fallo simulado');
    }
  });
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
});

afterAll(() => closeTestApp(app));

const headers = () => authHeaders(ana);

async function createProject(name: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/projects',
    headers: headers(),
    payload: { name },
  });
  const id = response.json().id as string;
  await app.inject({
    method: 'POST',
    url: `/projects/${id}/status`,
    headers: headers(),
    payload: { action: 'open' },
  });
  return id;
}

/** Siembra un detalle con un voto, un comentario y una entrada de historial. */
async function seedDetail(projectId: string, diagramId: string, activityKey: string) {
  const project = new Types.ObjectId(projectId);
  const detail = await detailsModel(app.mongo).create({
    projectId: project,
    diagramId: new Types.ObjectId(diagramId),
    activityKey,
    given: 'el cliente tiene productos',
    when: 'paga con tarjeta',
    then: 'confirma el pago',
    type: 'functional',
    authorId: new Types.ObjectId(ana.id),
  });
  const ref = { detailId: detail._id, projectId: project };
  await votesModel(app.mongo).create({ ...ref, userId: new Types.ObjectId() });
  await commentsModel(app.mongo).create({
    ...ref,
    authorId: new Types.ObjectId(ana.id),
    text: 'ok',
  });
  await historyModel(app.mongo).create({
    ...ref,
    rev: 0,
    snapshot: {},
    change: 'edit',
    editedBy: new Types.ObjectId(ana.id),
  });
  return detail;
}

async function counts(projectId: string) {
  const filter = { projectId: new Types.ObjectId(projectId) };
  return {
    details: await detailsModel(app.mongo).countDocuments(filter),
    votes: await votesModel(app.mongo).countDocuments(filter),
    comments: await commentsModel(app.mongo).countDocuments(filter),
    history: await historyModel(app.mongo).countDocuments(filter),
  };
}

async function deleteAndWait(projectId: string, name: string) {
  await app.inject({
    method: 'DELETE',
    url: `/projects/${projectId}`,
    headers: headers(),
    payload: { confirmName: name },
  });
  const deadline = Date.now() + 15_000;
  for (;;) {
    const project = await projectsModel(app.mongo).findById(projectId).lean<Project>();
    if (project?.deletion?.status === 'done') return project;
    if (Date.now() > deadline) throw new Error(`deletion = ${project?.deletion?.status}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('cascada de detalles al borrar el proyecto', () => {
  it('elimina detalles, votos, comentarios e historial, también si el job se reintenta', async () => {
    const projectId = await createProject('Con detalles');
    await seedDetail(projectId, new Types.ObjectId().toHexString(), 'k1');
    expect(await counts(projectId)).toEqual({ details: 1, votes: 1, comments: 1, history: 1 });
    failuresLeft.set(projectId, 1);
    const done = await deleteAndWait(projectId, 'Con detalles');
    expect(done.deletion?.attempts).toBe(2);
    expect(await counts(projectId)).toEqual({ details: 0, votes: 0, comments: 0, history: 0 });
  });
});

describe('dependiente de actividades (borrar una actividad con detalles)', () => {
  it('cuenta los detalles de su key, pide confirmación y, al confirmar, los conserva', async () => {
    const projectId = await createProject('Huérfanos');
    const v1 = (await uploadDiagram(app, headers(), projectId)).json();
    const activity = (
      await app.inject({
        method: 'POST',
        url: `/diagram-versions/${v1.id}/activities`,
        headers: headers(),
        payload: {
          label: 'Validar pago',
          type: 'action',
          bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
        },
      })
    ).json();
    await markPublished(app, v1.id);
    await seedDetail(projectId, v1.diagramId, activity.key);
    await seedDetail(projectId, v1.diagramId, activity.key);

    // La versión 2 copia la actividad con la misma key; se elimina en el borrador.
    const v2 = (await uploadVersion(app, headers(), v1.diagramId)).json();
    const copied = (
      await app.inject({ url: `/diagram-versions/${v2.id}`, headers: headers() })
    ).json().activities[0];
    const blocked = await app.inject({
      method: 'DELETE',
      url: `/activities/${copied.id}`,
      headers: headers(),
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', detailCount: 2 });
    expect(blocked.json().message).toMatch(/requisito.*reasignar/);

    const confirmed = await app.inject({
      method: 'DELETE',
      url: `/activities/${copied.id}?confirm=true`,
      headers: headers(),
    });
    expect(confirmed.statusCode).toBe(204);
    expect(await detailsModel(app.mongo).countDocuments({ activityKey: activity.key })).toBe(2);
  });
});
