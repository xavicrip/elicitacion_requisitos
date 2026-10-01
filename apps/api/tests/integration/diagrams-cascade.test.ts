import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activitiesModel } from '../../src/modules/diagrams/models/activity';
import { projectsModel, type Project } from '../../src/modules/projects/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { uploadDiagram } from '../helpers/diagrams';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Plan ajuste 6: la cascada de la 002 borra diagramas, versiones, actividades y objetos.

let app: FastifyInstance;
let ana: TestUser;
const failuresLeft = new Map<string, number>();

beforeAll(async () => {
  ({ app } = await buildTestApp('diagramscascade', {
    withAuth: true,
    deletion: { attempts: 3, backoffMs: 10 },
  }));
  // Se ejecuta después de la de diagramas: si falla, el job repite toda la cascada.
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

async function projectWithDiagrams(name: string) {
  const headers = authHeaders(ana);
  const projectId = (
    await app.inject({ method: 'POST', url: '/projects', headers, payload: { name } })
  ).json().id as string;
  const version = (await uploadDiagram(app, headers, projectId)).json();
  await uploadDiagram(app, headers, projectId, { name: 'Segundo' });
  await activitiesModel(app.mongo).create({
    versionId: new Types.ObjectId(version.id),
    diagramId: new Types.ObjectId(version.diagramId),
    projectId: new Types.ObjectId(projectId),
    label: 'Validar pago',
    type: 'decision',
    bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
  });
  return projectId;
}

async function deleteAndWait(projectId: string, name: string): Promise<Project> {
  await app.inject({
    method: 'DELETE',
    url: `/projects/${projectId}`,
    headers: authHeaders(ana),
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

async function leftovers(projectId: string) {
  const filter = { projectId: new Types.ObjectId(projectId) };
  return {
    diagrams: await app.mongo.collection('diagrams').countDocuments(filter),
    versions: await app.mongo.collection('diagram_versions').countDocuments(filter),
    activities: await app.mongo.collection('activities').countDocuments(filter),
    objects: (await app.storage.listKeys(`projects/${projectId}/`)).length,
  };
}

describe('cascada de diagramas al borrar el proyecto', () => {
  it('elimina diagramas, versiones, actividades y los objetos del bucket', async () => {
    const projectId = await projectWithDiagrams('Con diagramas');
    expect(await leftovers(projectId)).toEqual({
      diagrams: 2,
      versions: 2,
      activities: 1,
      objects: 6,
    });
    await deleteAndWait(projectId, 'Con diagramas');
    expect(await leftovers(projectId)).toEqual({
      diagrams: 0,
      versions: 0,
      activities: 0,
      objects: 0,
    });
  });

  it('es idempotente: si el job se reintenta, termina igual', async () => {
    const projectId = await projectWithDiagrams('Con reintento');
    failuresLeft.set(projectId, 1);
    const done = await deleteAndWait(projectId, 'Con reintento');
    expect(done.deletion?.attempts).toBe(2);
    expect(await leftovers(projectId)).toEqual({
      diagrams: 0,
      versions: 0,
      activities: 0,
      objects: 0,
    });
  });
});
