import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectsModel, type Project } from '../../src/modules/projects/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Feature 006: borrar un proyecto también borra sus detecciones y propuestas.

const COLLECTIONS = ['detection_jobs', 'activity_proposals', 'transition_proposals'];
let app: FastifyInstance;
let ana: TestUser;

beforeAll(async () => {
  ({ app } = await buildTestApp('detectioncascade', {
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

const seed = async (projectId: string) => {
  for (const name of COLLECTIONS) {
    await app.mongo.collection(name).insertOne({ projectId: new Types.ObjectId(projectId) });
  }
};
const counts = (projectId: string) =>
  Promise.all(
    COLLECTIONS.map((name) =>
      app.mongo.collection(name).countDocuments({ projectId: new Types.ObjectId(projectId) }),
    ),
  );

describe('cascada de la detección al borrar el proyecto', () => {
  it('elimina jobs y propuestas, y deja intactos los de otros proyectos', async () => {
    const projectId = await createProject('Con detección');
    const otherId = await createProject('Otro');
    await seed(projectId);
    await seed(otherId);
    await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}`,
      headers: authHeaders(ana),
      payload: { confirmName: 'Con detección' },
    });
    const deadline = Date.now() + 15_000;
    for (;;) {
      const project = await projectsModel(app.mongo).findById(projectId).lean<Project>();
      if (project?.deletion?.status === 'done') break;
      if (Date.now() > deadline) throw new Error(`deletion = ${project?.deletion?.status}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await counts(projectId)).toEqual([0, 0, 0]);
    expect(await counts(otherId)).toEqual([1, 1, 1]);
  });
});
