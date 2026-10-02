import { gunzipSync, gzipSync } from 'node:zlib';
import {
  DashboardFiltersSchema,
  type AnalysisInputFile,
  type DetailStatus,
  type DetailType,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analysisService } from '../../src/modules/dashboard/analysis.service';
import {
  analysisRunsModel,
  type AnalysisRunDoc,
} from '../../src/modules/dashboard/models/analysis-run';
import { duplicateDecisionsModel } from '../../src/modules/dashboard/models/duplicate-decision';
import { detailsModel } from '../../src/modules/details/models/detail';
import {
  EXAMPLE_RESULTS,
  startFakeAnalysisWorker,
  writeAnalysisHeartbeat,
  type AnalysisHandler,
} from '../helpers/analysis-worker';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Plan de la 007, ajustes 1 y 2 (T018): la cola `analysis` con un worker falso en Node. La
// entrada y los resultados viajan por el bucket; solo `api` escribe `analysis_runs`.

let app: FastifyInstance;
let dbName: string;
let ana: TestUser;
let handler: AnalysisHandler;
let worker: ReturnType<typeof startFakeAnalysisWorker>;

beforeAll(async () => {
  ({ app, dbName } = await buildTestApp('analysisqueue', {
    withAuth: true,
    featureFlags: 'dashboard=true',
    analysis: { timeoutMs: 60_000, sweepIntervalMs: 3_600_000 },
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  worker = startFakeAnalysisWorker(`test-${dbName}:bull`, (...args) => handler(...args));
});
afterAll(async () => {
  await worker.close();
  await closeTestApp(app);
});

/** Un worker que no responde hasta que se libera (sin bloquear las pruebas siguientes). */
let release: () => void = () => {};
const hang: AnalysisHandler = () =>
  new Promise((resolve) => {
    release = () => resolve({ summary: { status: 'failed', error: { code: 'INTERNAL' } } });
  });

const ok: AnalysisHandler = async (input) => ({
  results: EXAMPLE_RESULTS,
  summary: { detailCount: input.details.length },
});

async function project() {
  const projectId = await seedProject(app, { status: 'open', members: [[ana, 'admin']] });
  const diagram = await publishedDiagram(app, authHeaders(ana), projectId);
  return { projectId: new Types.ObjectId(projectId), ...diagram };
}

type Seed = Partial<{
  type: DetailType;
  status: DetailStatus;
  activity: string;
  createdAt: Date;
  authorRole: string | null;
}>;

async function seedDetails(
  target: Awaited<ReturnType<typeof project>>,
  items: Seed[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, item] of items.entries()) {
    const detail = await detailsModel(app.mongo).create({
      projectId: target.projectId,
      diagramId: new Types.ObjectId(target.diagramId),
      activityKey: target.keys[item.activity ?? 'Validar pago']!,
      given: `el cliente tiene el pedido ${index}`,
      when: 'paga con tarjeta',
      then: 'el sistema confirma el pago',
      type: item.type ?? 'functional',
      status: item.status ?? 'pending',
      authorRole: item.authorRole === undefined ? 'Cajero' : item.authorRole,
      tags: ['pagos'],
      authorId: new Types.ObjectId(ana.id),
      ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    });
    ids.push(detail._id.toHexString());
  }
  return ids;
}

const filters = (input: object = {}) => DashboardFiltersSchema.parse(input);

async function settled(runId: string, timeout = 10_000): Promise<AnalysisRunDoc> {
  let run: AnalysisRunDoc | null = null;
  await vi.waitFor(
    async () => {
      run = await analysisRunsModel(app.mongo).findById(runId).lean<AnalysisRunDoc>();
      expect(run?.status).toMatch(/^(done|failed)$/);
    },
    { timeout, interval: 50 },
  );
  return run!;
}

const create = (projectId: Types.ObjectId, input: object = {}) =>
  analysisService(app).create(projectId, {
    filters: filters(input),
    trigger: 'manual',
    requestedBy: ana.id,
  });

async function readObject(key: string) {
  const object = await app.storage.getStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of object!.body) chunks.push(Buffer.from(chunk as Uint8Array));
  return JSON.parse(gunzipSync(Buffer.concat(chunks)).toString('utf8')) as AnalysisInputFile;
}

describe('crear un análisis', () => {
  it('exporta la entrada sin autor, encola con dos URLs firmadas y el run termina done', async () => {
    handler = ok;
    const target = await project();
    const [first] = await seedDetails(target, [{}, { activity: 'Emitir factura' }, {}]);
    await duplicateDecisionsModel(app.mongo).create({
      projectId: target.projectId,
      pair: [first!, 'otro'],
      decision: 'rejected',
      decidedBy: new Types.ObjectId(ana.id),
    });

    const run = await create(target.projectId);
    expect(run.status).toBe('pending');
    const input = await readObject(run.inputKey);
    expect(input.details).toHaveLength(3);
    expect(input.details[0]).not.toHaveProperty('authorId');
    expect(input.details[0]).toMatchObject({ authorRole: 'Cajero', tags: ['pagos'] });
    expect(input.activities.map((activity) => activity.label).sort()).toEqual([
      'Emitir factura',
      'Enviar pedido',
      'Validar pago',
    ]);
    expect(input.duplicateDecisions).toEqual([{ pair: [first, 'otro'], decision: 'rejected' }]);

    const done = await settled(run._id.toHexString());
    expect(done).toMatchObject({ status: 'done', partial: false, detailCount: 3, error: null });
    expect(done.stages).toEqual(EXAMPLE_RESULTS.stages);
    const job = worker.received.at(-1)!.data;
    expect(job.inputUrl).toContain('X-Amz-Signature=');
    expect(job.resultsUrl).toContain('X-Amz-Signature=');
    expect(job.stages).toHaveLength(10);
    expect(job.settings.insightsEnabled).toBe(false);
    expect(await analysisService(app).results(done)).toEqual(EXAMPLE_RESULTS);
  });

  it('aplica los filtros: tipo, estado y rango de fechas (zona horaria del proyecto)', async () => {
    handler = ok;
    const target = await project();
    await seedDetails(target, [
      { type: 'non_functional', createdAt: new Date('2026-09-10T15:00:00Z') },
      { type: 'functional', createdAt: new Date('2026-09-10T15:00:00Z') },
      { type: 'non_functional', status: 'discarded', createdAt: new Date('2026-09-10T15:00:00Z') },
      { type: 'non_functional', status: 'duplicate', createdAt: new Date('2026-09-10T15:00:00Z') },
      // 2026-09-11 a las 02:00 UTC es aún el día 10 en Guayaquil (UTC-5).
      { type: 'non_functional', createdAt: new Date('2026-09-11T02:00:00Z') },
      { type: 'non_functional', createdAt: new Date('2026-09-12T15:00:00Z') },
    ]);
    const run = await create(target.projectId, {
      types: ['non_functional'],
      from: '2026-09-10',
      to: '2026-09-10',
    });
    const input = await readObject(run.inputKey);
    expect(input.details).toHaveLength(2);
    expect(input.filters).toMatchObject({ types: ['non_functional'], from: '2026-09-10' });
    await settled(run._id.toHexString());
  });

  it('un segundo análisis activo en el proyecto → 409 ANALYSIS_IN_PROGRESS con su id', async () => {
    handler = hang;
    const target = await project();
    const first = await create(target.projectId);
    await expect(create(target.projectId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ANALYSIS_IN_PROGRESS',
      extra: { runId: first._id.toHexString() },
    });
    release();
    await settled(first._id.toHexString());
  });
});

describe('retorno del worker', () => {
  it('una etapa fallida deja el run done con partial', async () => {
    handler = async (input) => ({
      results: EXAMPLE_RESULTS,
      summary: {
        detailCount: input.details.length,
        partial: true,
        stages: { ...EXAMPLE_RESULTS.stages, sentiment: { status: 'failed', error: 'OSError' } },
      },
    });
    const target = await project();
    await seedDetails(target, [{}]);
    const done = await settled((await create(target.projectId))._id.toHexString());
    expect(done).toMatchObject({ status: 'done', partial: true });
    expect(done.stages.sentiment).toEqual({ status: 'failed', error: 'OSError' });
  });

  it.each([
    [
      'INPUT_DOWNLOAD_FAILED',
      'No se pudieron leer los detalles para el análisis. Vuelve a intentarlo.',
    ],
    [
      'RESULTS_UPLOAD_FAILED',
      'No se pudieron guardar los resultados del análisis. Vuelve a intentarlo.',
    ],
    ['ALGO_RARO', 'No se pudo completar el análisis. Vuelve a intentarlo.'],
  ])('failed con %s → run failed con un mensaje en español', async (code, message) => {
    handler = async () => ({
      summary: { status: 'failed', detailCount: 0, stages: {}, error: { code } },
    });
    const target = await project();
    const failed = await settled((await create(target.projectId))._id.toHexString());
    expect(failed.status).toBe('failed');
    expect(failed.error?.message).toBe(message);
  });

  it('unos resultados que no cumplen el contrato dejan el run failed', async () => {
    handler = async () => ({ results: { schemaVersion: 7 } });
    const target = await project();
    const failed = await settled((await create(target.projectId))._id.toHexString());
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'INTERNAL' } });
  });

  it('el worker que lanza una excepción deja el run failed', async () => {
    handler = async () => {
      throw new Error('detalle interno');
    };
    const target = await project();
    const failed = await settled((await create(target.projectId))._id.toHexString());
    expect(failed.error?.code).toBe('INTERNAL');
  });
});

describe('timeout y retención', () => {
  it('sin respuesta a tiempo, el barrido deja el run failed por TIMEOUT', async () => {
    handler = hang;
    const target = await project();
    const run = await create(target.projectId);
    // `createdAt` es inmutable en el modelo: se envejece directamente en la colección.
    await app.mongo
      .collection('analysis_runs')
      .updateOne({ _id: run._id }, { $set: { createdAt: new Date(Date.now() - 120_000) } });
    expect(await app.analysis.sweep()).toContain(run._id.toHexString());
    const failed = await analysisRunsModel(app.mongo).findById(run._id).lean<AnalysisRunDoc>();
    expect(failed).toMatchObject({
      status: 'failed',
      error: {
        code: 'TIMEOUT',
        message: 'El análisis tardó demasiado. Vuelve a intentarlo más tarde.',
      },
    });
    release();
  });

  it('conserva los 10 últimos runs y borra los anteriores con sus archivos', async () => {
    handler = ok;
    const target = await project();
    await seedDetails(target, [{}]);
    const runs: AnalysisRunDoc[] = [];
    for (let i = 0; i < 12; i++) {
      runs.push(await settled((await create(target.projectId))._id.toHexString()));
    }
    const left = await analysisRunsModel(app.mongo)
      .find({ projectId: target.projectId })
      .lean<AnalysisRunDoc[]>();
    expect(left).toHaveLength(10);
    expect(left.map((run) => run._id.toHexString())).not.toContain(runs[0]!._id.toHexString());
    expect(await app.storage.getStream(runs[0]!.resultsKey)).toBeNull();
    expect(await app.storage.getStream(runs[11]!.resultsKey)).not.toBeNull();
  }, 60_000);
});

describe('obsolescencia', () => {
  it('un detalle nuevo después del run lo marca como desactualizado', async () => {
    handler = ok;
    const target = await project();
    await seedDetails(target, [{}, {}]);
    const service = analysisService(app);
    const done = await settled((await create(target.projectId))._id.toHexString());
    expect(await service.toDto(done)).toMatchObject({ stale: false, newDetailsSinceRun: 0 });
    await seedDetails(target, [{}]);
    expect(await service.toDto(done)).toMatchObject({ stale: true, newDetailsSinceRun: 1 });
  });
});

describe('salud', () => {
  it('/health/deep incluye analysis-worker: down sin latido, up con él', async () => {
    const before = (await app.inject({ url: '/health/deep' })).json();
    expect(before.checks['analysis-worker'].status).toBe('down');
    await writeAnalysisHeartbeat(`test-${dbName}:`);
    const after = (await app.inject({ url: '/health/deep' })).json();
    expect(after.checks['analysis-worker'].status).toBe('up');
  });
});

describe('subida directa', () => {
  it('los resultados solo se aceptan en la clave del run', async () => {
    handler = ok;
    const target = await project();
    const run = await create(target.projectId);
    await settled(run._id.toHexString());
    const url = await app.storage.presignPut(run.resultsKey, 'application/gzip', 60);
    const other = url.replace(run.resultsKey, `${run.resultsKey}.bak`);
    const response = await fetch(other, {
      method: 'PUT',
      body: gzipSync('{}'),
      headers: { 'content-type': 'application/gzip' },
    });
    expect(response.status).toBe(403);
  });
});
