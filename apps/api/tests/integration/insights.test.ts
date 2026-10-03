import type { AnalysisResults } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { insightFeedbackModel } from '../../src/modules/dashboard/models/insight-feedback';
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

// US5 de la 007 (FR-012): valorar los insights y regenerar el resumen.

const INSIGHTS: NonNullable<AnalysisResults['insights']> = [
  {
    id: 'i1',
    title: 'Uno',
    statement: 'Primer hallazgo.',
    evidence: [{ kind: 'kpi', id: 'total_details' }],
  },
  {
    id: 'i2',
    title: 'Dos',
    statement: 'Segundo hallazgo.',
    evidence: [{ kind: 'kpi', id: 'total_details' }],
  },
];
const WITH_INSIGHTS: AnalysisResults = {
  ...EXAMPLE_RESULTS,
  stages: { ...EXAMPLE_RESULTS.stages, insights: { status: 'done' } },
  insights: INSIGHTS,
};

type Harness = {
  app: FastifyInstance;
  worker: ReturnType<typeof startFakeAnalysisWorker>;
  ana: TestUser;
  luis: TestUser;
};
let handler: AnalysisHandler;

async function harness(prefix: string, featureFlags: string): Promise<Harness> {
  const { app, dbName } = await buildTestApp(prefix, { withAuth: true, featureFlags });
  await app.ready();
  return {
    app,
    worker: startFakeAnalysisWorker(`test-${dbName}:bull`, (...args) => handler(...args)),
    ana: await registerTestUser(app, 'Ana'),
    luis: await registerTestUser(app, 'Luis'),
  };
}

const ok: AnalysisHandler = async (input, data) => ({
  results:
    data.kind === 'insights'
      ? { ...WITH_INSIGHTS, insights: [{ ...INSIGHTS[0]!, id: 'i1', title: 'Regenerado' }] }
      : WITH_INSIGHTS,
  summary: { detailCount: input.details.length, stages: WITH_INSIGHTS.stages },
});

async function analysed({ app, ana, luis }: Harness) {
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
    ],
  });
  const diagram = await publishedDiagram(app, authHeaders(ana), projectId);
  await detailsModel(app.mongo).create({
    projectId: new Types.ObjectId(projectId),
    diagramId: new Types.ObjectId(diagram.diagramId),
    activityKey: diagram.keys['Validar pago']!,
    given: 'el cliente tiene un pedido',
    when: 'paga con tarjeta',
    then: 'el sistema confirma el pago',
    type: 'functional',
    authorId: new Types.ObjectId(ana.id),
  });
  const run = (
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/analysis-runs`,
      headers: authHeaders(ana),
    })
  ).json();
  await done(app, ana, run.id);
  return { projectId, runId: run.id as string };
}

async function done(app: FastifyInstance, user: TestUser, runId: string) {
  let body: Record<string, unknown> = {};
  await vi.waitFor(
    async () => {
      body = (
        await app.inject({ url: `/analysis-runs/${runId}`, headers: authHeaders(user) })
      ).json();
      expect(body.status).toMatch(/^(done|failed)$/);
    },
    { timeout: 10_000, interval: 50 },
  );
  return body as { status: string; results: AnalysisResults; kind: string };
}

describe('con el flag insights', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness('insightson', 'insights=true');
  });
  afterAll(async () => {
    await h.worker.close();
    await closeTestApp(h.app);
  });
  const post = (url: string, payload?: object, user = h.ana) =>
    h.app.inject({
      method: 'POST',
      url,
      headers: authHeaders(user),
      ...(payload ? { payload } : {}),
    });
  const latest = async (projectId: string) =>
    (
      await h.app.inject({
        url: `/projects/${projectId}/analysis-runs/latest`,
        headers: authHeaders(h.ana),
      })
    ).json();

  it('el análisis pide la etapa insights al worker', async () => {
    handler = ok;
    await analysed(h);
    expect(h.worker.received.at(-1)!.data.settings.insightsEnabled).toBe(true);
  });

  it('«no útil» guarda la valoración, oculta el insight y el siguiente análisis lo recibe', async () => {
    handler = ok;
    const { projectId, runId } = await analysed(h);
    expect((await latest(projectId)).results.insights).toHaveLength(2);

    const response = await post(`/analysis-runs/${runId}/insights/i1/feedback`, { useful: false });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    const stored = await insightFeedbackModel(h.app.mongo).findOne({ runId }).lean();
    expect(stored).toMatchObject({ insightId: 'i1', useful: false, statement: 'Primer hallazgo.' });
    expect((await latest(projectId)).results.insights.map((i: { id: string }) => i.id)).toEqual([
      'i2',
    ]);

    const next = (await post(`/projects/${projectId}/analysis-runs`)).json();
    await done(h.app, h.ana, next.id);
    expect(h.worker.received.at(-1)!.data.settings.rejectedInsights).toEqual(['Primer hallazgo.']);
  });

  it('valorar dos veces actualiza la misma valoración; un insight inexistente → 404', async () => {
    handler = ok;
    const { runId } = await analysed(h);
    await post(`/analysis-runs/${runId}/insights/i2/feedback`, { useful: false });
    await post(`/analysis-runs/${runId}/insights/i2/feedback`, { useful: true });
    const all = await insightFeedbackModel(h.app.mongo).find({ runId }).lean();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ useful: true });
    expect(
      (await post(`/analysis-runs/${runId}/insights/nope/feedback`, { useful: false })).statusCode,
    ).toBe(404);
    expect((await post(`/analysis-runs/${runId}/insights/i1/feedback`, {})).statusCode).toBe(400);
  });

  it('regenerar encola solo la etapa insights con los resultados anteriores y sustituye el resumen', async () => {
    handler = ok;
    const { projectId, runId } = await analysed(h);
    const response = await post(`/analysis-runs/${runId}/insights/regenerate`);
    expect(response.statusCode).toBe(202);
    const run = response.json();
    expect(run).toMatchObject({ kind: 'insights', status: 'pending', projectId });
    expect(run.id).not.toBe(runId);
    const finished = await done(h.app, h.ana, run.id);
    const job = h.worker.received.at(-1)!;
    expect(job.data).toMatchObject({ kind: 'insights', stages: ['insights'] });
    expect(job.data.previousResultsUrl).toContain(`/analysis/${runId}/results.json.gz`);
    expect(job.input.details).toHaveLength(1);
    expect(finished.results.insights![0]).toMatchObject({ title: 'Regenerado' });
    // El último análisis es ahora el regenerado, con el resto de secciones intacto.
    const current = await latest(projectId);
    expect(current.id).toBe(run.id);
    expect(current.results.topics).toEqual(EXAMPLE_RESULTS.topics);
    expect(current.input.details).toHaveLength(1);
  });

  it('con un análisis en curso → 409; Participante → 403', async () => {
    handler = ok;
    const { runId } = await analysed(h);
    let release: () => void = () => {};
    handler = async (...args) => {
      await new Promise<void>((resolve) => (release = resolve));
      return ok(...args);
    };
    const first = await post(`/analysis-runs/${runId}/insights/regenerate`);
    expect(first.statusCode).toBe(202);
    const second = await post(`/analysis-runs/${runId}/insights/regenerate`);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'ANALYSIS_IN_PROGRESS', runId: first.json().id });
    await vi.waitFor(() => expect(release).not.toBe(undefined));
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await done(h.app, h.ana, first.json().id);

    for (const url of [
      `/analysis-runs/${runId}/insights/regenerate`,
      `/analysis-runs/${runId}/insights/i1/feedback`,
    ]) {
      expect((await post(url, { useful: false }, h.luis)).statusCode, url).toBe(403);
    }
  });
});

describe('sin el flag insights', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness('insightsoff', '');
  });
  afterAll(async () => {
    await h.worker.close();
    await closeTestApp(h.app);
  });

  it('el análisis no pide el resumen y regenerarlo responde 409 con un mensaje', async () => {
    handler = ok;
    const { runId } = await analysed(h);
    expect(h.worker.received.at(-1)!.data.settings.insightsEnabled).toBe(false);
    const response = await h.app.inject({
      method: 'POST',
      url: `/analysis-runs/${runId}/insights/regenerate`,
      headers: authHeaders(h.ana),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 'INSIGHTS_DISABLED',
      message: 'El resumen de hallazgos no está activado en este entorno.',
    });
  });
});
