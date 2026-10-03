import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportsModel } from '../../src/modules/exports/models/export';
import { projectsModel, type Project } from '../../src/modules/projects/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Plan de la 008, ajuste 11: borrar un proyecto borra sus exportaciones (con el flag apagado).

let app: FastifyInstance;
let ana: TestUser;

beforeAll(async () => {
  ({ app } = await buildTestApp('exportscascade', {
    withAuth: true,
    deletion: { attempts: 3, backoffMs: 10 },
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
});

afterAll(() => closeTestApp(app));

async function createProject(name: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/projects',
    headers: authHeaders(ana),
    payload: { name },
  });
  return response.json().id as string;
}

const seed = (projectId: string) =>
  exportsModel(app.mongo).create({
    projectId: new Types.ObjectId(projectId),
    format: 'csv',
    options: { delimiter: 'comma', includePending: false },
    filters: { diagramIds: null, from: null, to: null, types: null, statuses: ['pending'] },
    mode: 'sync',
    status: 'done',
    detailCount: 3,
    requestedBy: new Types.ObjectId(ana.id),
  });

const count = (projectId: string) =>
  exportsModel(app.mongo).countDocuments({ projectId: new Types.ObjectId(projectId) });

describe('cascada de exportaciones al borrar el proyecto', () => {
  it('elimina las del proyecto y deja intactas las de otros', async () => {
    const projectId = await createProject('Con exportaciones');
    const otherId = await createProject('Otro');
    await seed(projectId);
    await seed(otherId);
    await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}`,
      headers: authHeaders(ana),
      payload: { confirmName: 'Con exportaciones' },
    });
    const deadline = Date.now() + 15_000;
    for (;;) {
      const project = await projectsModel(app.mongo).findById(projectId).lean<Project>();
      if (project?.deletion?.status === 'done') break;
      if (Date.now() > deadline) throw new Error(`deletion = ${project?.deletion?.status}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await count(projectId)).toBe(0);
    expect(await count(otherId)).toBe(1);
  });
});
