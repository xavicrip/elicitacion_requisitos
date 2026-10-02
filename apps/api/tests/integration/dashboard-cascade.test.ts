import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analysisRunsModel } from '../../src/modules/dashboard/models/analysis-run';
import { analysisSettingsModel } from '../../src/modules/dashboard/models/analysis-settings';
import { duplicateDecisionsModel } from '../../src/modules/dashboard/models/duplicate-decision';
import { insightFeedbackModel } from '../../src/modules/dashboard/models/insight-feedback';
import { projectsModel, type Project } from '../../src/modules/projects/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Plan de la 007, T015: borrar un proyecto borra sus análisis, decisiones, valoraciones y ajustes.

let app: FastifyInstance;
let ana: TestUser;

beforeAll(async () => {
  ({ app } = await buildTestApp('dashboardcascade', {
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

async function seed(projectId: string) {
  const project = new Types.ObjectId(projectId);
  const run = await analysisRunsModel(app.mongo).create({
    projectId: project,
    trigger: 'manual',
    filters: { diagramIds: null, from: null, to: null, types: null, statuses: ['pending'] },
    status: 'done',
    dataFingerprint: { count: 0, maxUpdatedAt: null },
    inputKey: `projects/${projectId}/analysis/x/input.json.gz`,
    resultsKey: `projects/${projectId}/analysis/x/results.json.gz`,
  });
  await duplicateDecisionsModel(app.mongo).create({
    projectId: project,
    pair: ['a', 'b'],
    decision: 'rejected',
    decidedBy: new Types.ObjectId(ana.id),
  });
  await insightFeedbackModel(app.mongo).create({
    projectId: project,
    runId: run._id,
    insightId: 'i1',
    useful: false,
    statement: 'Un insight',
    userId: new Types.ObjectId(ana.id),
  });
  await analysisSettingsModel(app.mongo).create({ projectId: project });
}

async function counts(projectId: string) {
  const filter = { projectId: new Types.ObjectId(projectId) };
  return [
    await analysisRunsModel(app.mongo).countDocuments(filter),
    await duplicateDecisionsModel(app.mongo).countDocuments(filter),
    await insightFeedbackModel(app.mongo).countDocuments(filter),
    await analysisSettingsModel(app.mongo).countDocuments(filter),
  ];
}

describe('cascada del dashboard al borrar el proyecto', () => {
  it('elimina runs, decisiones, valoraciones y ajustes, y deja intactos los de otros proyectos', async () => {
    const projectId = await createProject('Con análisis');
    const otherId = await createProject('Otro');
    await seed(projectId);
    await seed(otherId);
    expect(await counts(projectId)).toEqual([1, 1, 1, 1]);
    await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}`,
      headers: authHeaders(ana),
      payload: { confirmName: 'Con análisis' },
    });
    const deadline = Date.now() + 15_000;
    for (;;) {
      const project = await projectsModel(app.mongo).findById(projectId).lean<Project>();
      if (project?.deletion?.status === 'done') break;
      if (Date.now() > deadline) throw new Error(`deletion = ${project?.deletion?.status}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await counts(projectId)).toEqual([0, 0, 0, 0]);
    expect(await counts(otherId)).toEqual([1, 1, 1, 1]);
  });
});
