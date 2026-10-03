import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  analysisRunsModel,
  type AnalysisRunDoc,
} from '../../src/modules/dashboard/models/analysis-run';
import { detailsModel } from '../../src/modules/details/models/detail';
import { startFakeAnalysisWorker } from '../helpers/analysis-worker';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// FR-013 (plan de la 007, ajuste 9): análisis programados por proyecto, solo si hubo cambios.

let app: FastifyInstance;
let ana: TestUser;
let worker: ReturnType<typeof startFakeAnalysisWorker>;

beforeAll(async () => {
  let dbName: string;
  ({ app, dbName } = await buildTestApp('analysisschedule', {
    withAuth: true,
    featureFlags: 'dashboard=true',
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  worker = startFakeAnalysisWorker(`test-${dbName}:bull`);
});
afterAll(async () => {
  await worker.close();
  await closeTestApp(app);
});

const SCHEDULE = { enabled: true, cron: '30 2 * * *', timezone: 'America/Guayaquil' };

async function project(details = 0) {
  const projectId = await seedProject(app, { status: 'open', members: [[ana, 'admin']] });
  const diagram = await publishedDiagram(app, authHeaders(ana), projectId);
  await addDetails(projectId, diagram, details);
  return { projectId, ...diagram };
}

async function addDetails(
  projectId: string,
  diagram: { diagramId: string; keys: Record<string, string> },
  count: number,
) {
  for (let index = 0; index < count; index++) {
    await detailsModel(app.mongo).create({
      projectId: new Types.ObjectId(projectId),
      diagramId: new Types.ObjectId(diagram.diagramId),
      activityKey: diagram.keys['Validar pago']!,
      given: `el cliente tiene el pedido ${index}`,
      when: 'paga con tarjeta',
      then: 'el sistema confirma el pago',
      type: 'functional',
      authorId: new Types.ObjectId(ana.id),
    });
  }
}

const save = (projectId: string, schedule: object) =>
  app.inject({
    method: 'PUT',
    url: `/projects/${projectId}/analysis-settings`,
    headers: authHeaders(ana),
    payload: { extraAmbiguousTerms: [], extraStopwords: [], schedule },
  });
const scheduler = async (projectId: string) =>
  (await app.analysisSchedule.list()).find((item) => item.projectId === projectId);
const runs = (projectId: string) =>
  analysisRunsModel(app.mongo)
    .find({ projectId: new Types.ObjectId(projectId) })
    .sort({ createdAt: 1 })
    .lean<AnalysisRunDoc[]>();

async function settled(runId: Types.ObjectId) {
  await vi.waitFor(
    async () => {
      const run = await analysisRunsModel(app.mongo).findById(runId).lean<AnalysisRunDoc>();
      expect(run?.status).toBe('done');
    },
    { timeout: 10_000, interval: 50 },
  );
}

describe('programador por proyecto', () => {
  it('por defecto no hay ninguno; activarlo lo crea con su cron y zona horaria', async () => {
    const { projectId } = await project();
    expect(await scheduler(projectId)).toBeUndefined();
    expect((await save(projectId, SCHEDULE)).statusCode).toBe(200);
    expect(await scheduler(projectId)).toMatchObject({
      pattern: '30 2 * * *',
      tz: 'America/Guayaquil',
    });
    // Cambiar la hora actualiza el mismo programador.
    await save(projectId, { ...SCHEDULE, cron: '0 5 * * *' });
    expect((await app.analysisSchedule.list()).filter((s) => s.projectId === projectId)).toEqual([
      expect.objectContaining({ pattern: '0 5 * * *' }),
    ]);
  });

  it('desactivarlo, cerrar el proyecto o borrarlo lo elimina', async () => {
    const first = await project();
    await save(first.projectId, SCHEDULE);
    await save(first.projectId, { ...SCHEDULE, enabled: false });
    expect(await scheduler(first.projectId)).toBeUndefined();

    const second = await project();
    await save(second.projectId, SCHEDULE);
    await app.inject({
      method: 'POST',
      url: `/projects/${second.projectId}/status`,
      headers: authHeaders(ana),
      payload: { action: 'close' },
    });
    await vi.waitFor(async () => expect(await scheduler(second.projectId)).toBeUndefined(), {
      timeout: 3000,
      interval: 50,
    });

    const third = await project();
    await save(third.projectId, SCHEDULE);
    const { name } = (
      await app.inject({
        method: 'GET',
        url: `/projects/${third.projectId}`,
        headers: authHeaders(ana),
      })
    ).json<{ name: string }>();
    await app.inject({
      method: 'DELETE',
      url: `/projects/${third.projectId}`,
      headers: authHeaders(ana),
      payload: { confirmName: name },
    });
    await vi.waitFor(async () => expect(await scheduler(third.projectId)).toBeUndefined(), {
      timeout: 15_000,
      interval: 50,
    });
  });
});

describe('al dispararse', () => {
  it('lanza un análisis programado solo si los datos cambiaron desde el último', async () => {
    const target = await project(2);
    const first = await app.analysisSchedule.fire(target.projectId);
    expect(first).toMatchObject({ trigger: 'scheduled', requestedBy: null, status: 'pending' });
    await settled(first!._id);

    expect(await app.analysisSchedule.fire(target.projectId)).toBeNull();
    expect(await runs(target.projectId)).toHaveLength(1);

    await addDetails(target.projectId, target, 1);
    const second = await app.analysisSchedule.fire(target.projectId);
    expect(second).not.toBeNull();
    await settled(second!._id);
    expect((await runs(target.projectId)).map((run) => run.detailCount)).toEqual([2, 3]);
  });

  it('sin detalles o con el proyecto cerrado no hace nada', async () => {
    const empty = await project(0);
    expect(await app.analysisSchedule.fire(empty.projectId)).toBeNull();

    const closed = await project(1);
    await app.inject({
      method: 'POST',
      url: `/projects/${closed.projectId}/status`,
      headers: authHeaders(ana),
      payload: { action: 'close' },
    });
    expect(await app.analysisSchedule.fire(closed.projectId)).toBeNull();
    expect(await runs(closed.projectId)).toEqual([]);
  });

  it('con un análisis ya en curso no lanza otro', async () => {
    const target = await project(1);
    const running = await analysisRunsModel(app.mongo).create({
      projectId: new Types.ObjectId(target.projectId),
      trigger: 'manual',
      filters: { diagramIds: null, from: null, to: null, types: null, statuses: ['pending'] },
      status: 'running',
      dataFingerprint: { count: 0, maxUpdatedAt: null },
      inputKey: 'x',
      resultsKey: 'y',
    });
    expect(await app.analysisSchedule.fire(target.projectId)).toBeNull();
    expect(await runs(target.projectId)).toHaveLength(1);
    await analysisRunsModel(app.mongo).deleteOne({ _id: running._id });
  });
});
