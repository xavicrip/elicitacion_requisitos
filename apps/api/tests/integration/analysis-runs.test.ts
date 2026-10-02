import type { DetailType } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { detailsModel } from '../../src/modules/details/models/detail';
import {
  EXAMPLE_RESULTS,
  startFakeAnalysisWorker,
  type AnalysisHandler,
} from '../helpers/analysis-worker';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US2 de la 007 (FR-013, FR-014): lanzar un análisis, seguir su progreso y leer sus resultados.

let app: FastifyInstance;
let ana: TestUser;
let luis: TestUser;
let outsider: TestUser;
let handler: AnalysisHandler;
let worker: ReturnType<typeof startFakeAnalysisWorker>;

const ok: AnalysisHandler = async (input, _data, job) => {
  await job.updateProgress({ stage: 'topics', pct: 30 });
  return { results: EXAMPLE_RESULTS, summary: { detailCount: input.details.length } };
};

beforeAll(async () => {
  let dbName: string;
  ({ app, dbName } = await buildTestApp('analysisruns', {
    withAuth: true,
    featureFlags: 'dashboard=true',
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
  outsider = await registerTestUser(app, 'Otra');
  worker = startFakeAnalysisWorker(`test-${dbName}:bull`, (...args) => handler(...args));
});
afterAll(async () => {
  await worker.close();
  await closeTestApp(app);
});

async function project(details = 2) {
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
    ],
  });
  const diagram = await publishedDiagram(app, authHeaders(ana), projectId);
  await addDetails(projectId, diagram, details);
  return { projectId, ...diagram };
}

async function addDetails(
  projectId: string,
  diagram: { diagramId: string; keys: Record<string, string> },
  count: number,
  type: DetailType = 'functional',
) {
  for (let index = 0; index < count; index++) {
    await detailsModel(app.mongo).create({
      projectId: new Types.ObjectId(projectId),
      diagramId: new Types.ObjectId(diagram.diagramId),
      activityKey: diagram.keys['Validar pago']!,
      given: `el cliente tiene el pedido ${index}`,
      when: 'paga con tarjeta',
      then: 'el sistema confirma el pago',
      type,
      authorId: new Types.ObjectId(ana.id),
    });
  }
}

const start = (projectId: string, payload?: object, user = ana) =>
  app.inject({
    method: 'POST',
    url: `/projects/${projectId}/analysis-runs`,
    headers: authHeaders(user),
    ...(payload ? { payload } : {}),
  });
const get = (url: string, user = ana) => app.inject({ url, headers: authHeaders(user) });

async function finished(runId: string) {
  let body: Record<string, unknown> = {};
  await vi.waitFor(
    async () => {
      body = (await get(`/analysis-runs/${runId}`)).json();
      expect(body.status).toMatch(/^(done|failed)$/);
    },
    { timeout: 10_000, interval: 50 },
  );
  return body;
}

describe('lanzar y consultar', () => {
  it('POST → 202 con el run pending; al terminar, GET lo devuelve done con sus resultados', async () => {
    handler = ok;
    const { projectId } = await project();
    const response = await start(projectId);
    expect(response.statusCode).toBe(202);
    const run = response.json();
    expect(run).toMatchObject({
      projectId,
      status: 'pending',
      partial: false,
      kind: 'full',
      trigger: 'manual',
      stale: false,
      newDetailsSinceRun: 0,
      error: null,
      finishedAt: null,
      filters: { statuses: ['pending', 'validated'], types: null },
    });
    expect(run).not.toHaveProperty('results');

    const done = await finished(run.id);
    expect(done).toMatchObject({ status: 'done', detailCount: 2, progress: null });
    expect(done.results).toEqual(EXAMPLE_RESULTS);
    expect(done.stages).toEqual(EXAMPLE_RESULTS.stages);
  });

  it('mientras corre, el GET muestra el progreso por etapa', async () => {
    let release: () => void = () => {};
    handler = async (input, data, job) => {
      await job.updateProgress({ stage: 'topics', pct: 30 });
      await new Promise<void>((resolve) => (release = resolve));
      return ok(input, data, job);
    };
    const { projectId } = await project();
    const run = (await start(projectId)).json();
    await vi.waitFor(
      async () => {
        const body = (await get(`/analysis-runs/${run.id}`)).json();
        expect(body).toMatchObject({ status: 'running', progress: { stage: 'topics', pct: 30 } });
      },
      { timeout: 5000, interval: 50 },
    );
    const again = await start(projectId);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      code: 'ANALYSIS_IN_PROGRESS',
      message: 'Ya hay un análisis en curso en este proyecto. Espera a que termine.',
      runId: run.id,
    });
    release();
    await finished(run.id);
  });

  it('se puede lanzar con filtros, y el run indica con cuáles se calculó', async () => {
    handler = ok;
    const target = await project(1);
    await addDetails(target.projectId, target, 2, 'non_functional');
    const run = (await start(target.projectId, { filters: { types: ['non_functional'] } })).json();
    expect(run.filters.types).toEqual(['non_functional']);
    const done = await finished(run.id);
    expect(done.detailCount).toBe(2);
    expect(worker.received.at(-1)!.input.details.every((d) => d.type === 'non_functional')).toBe(
      true,
    );
  });

  it('unos filtros inválidos → 400', async () => {
    const { projectId } = await project(0);
    const response = await start(projectId, { filters: { from: '2026-10-05', to: '2026-10-01' } });
    expect(response.statusCode).toBe(400);
  });
});

describe('último análisis y obsolescencia (FR-014)', () => {
  it('latest devuelve el último terminado con resultados; antes, 404', async () => {
    handler = ok;
    const target = await project();
    const before = await get(`/projects/${target.projectId}/analysis-runs/latest`);
    expect(before.statusCode).toBe(404);
    expect(before.json().message).toBe('Todavía no hay ningún análisis.');

    const run = (await start(target.projectId)).json();
    await finished(run.id);
    const latest = (await get(`/projects/${target.projectId}/analysis-runs/latest`)).json();
    expect(latest).toMatchObject({ id: run.id, status: 'done', stale: false });
    expect(latest.results.schemaVersion).toBe(1);

    await addDetails(target.projectId, target, 3);
    const stale = (await get(`/projects/${target.projectId}/analysis-runs/latest`)).json();
    expect(stale).toMatchObject({ stale: true, newDetailsSinceRun: 3 });
  });

  it('un análisis fallido no sustituye al último terminado, y el historial los lista todos', async () => {
    handler = ok;
    const target = await project();
    const first = (await start(target.projectId)).json();
    await finished(first.id);
    handler = async () => ({
      summary: { status: 'failed', detailCount: 0, stages: {}, error: { code: 'TIMEOUT' } },
    });
    const second = (await start(target.projectId)).json();
    const failed = await finished(second.id);
    expect(failed).toMatchObject({
      status: 'failed',
      error: {
        code: 'TIMEOUT',
        message: 'El análisis tardó demasiado. Vuelve a intentarlo más tarde.',
      },
    });
    expect(failed).not.toHaveProperty('results');

    const latest = (await get(`/projects/${target.projectId}/analysis-runs/latest`)).json();
    expect(latest.id).toBe(first.id);
    const list = (await get(`/projects/${target.projectId}/analysis-runs`)).json();
    expect(list.map((run: { id: string }) => run.id)).toEqual([second.id, first.id]);
    expect(list[1]).not.toHaveProperty('results');
  });
});

describe('acceso (FR-001)', () => {
  it('Participante → 403; quien no es miembro → 404; id inexistente → 404', async () => {
    handler = ok;
    const { projectId } = await project();
    const run = (await start(projectId)).json();
    await finished(run.id);
    for (const [method, url] of [
      ['POST', `/projects/${projectId}/analysis-runs`],
      ['GET', `/projects/${projectId}/analysis-runs`],
      ['GET', `/projects/${projectId}/analysis-runs/latest`],
      ['GET', `/analysis-runs/${run.id}`],
    ] as const) {
      const asParticipant = await app.inject({ method, url, headers: authHeaders(luis) });
      expect(asParticipant.statusCode, `${method} ${url}`).toBe(403);
      const asOutsider = await app.inject({ method, url, headers: authHeaders(outsider) });
      expect(asOutsider.statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await get('/analysis-runs/66f3a1b2c3d4e5f601234567')).statusCode).toBe(404);
  });
});
