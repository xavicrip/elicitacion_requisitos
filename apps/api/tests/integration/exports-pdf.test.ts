import { ExportInputFileSchema, ExportJobInputSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { duplicateDecisionsModel } from '../../src/modules/dashboard/models/duplicate-decision';
import { insightFeedbackModel } from '../../src/modules/dashboard/models/insight-feedback';
import { detailsModel } from '../../src/modules/details/models/detail';
import { exportsModel, type ExportDoc } from '../../src/modules/exports/models/export';
import { EXAMPLE_RESULTS, startFakeAnalysisWorker } from '../helpers/analysis-worker';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { publishedDiagram } from '../helpers/details';
import {
  clearExportHeartbeat,
  FAKE_PDF,
  startFakeExportWorker,
  writeExportHeartbeat,
  type ExportHandler,
} from '../helpers/export-worker';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US3 de la 008 (FR-005, FR-006, SC-004): el reporte PDF lo genera `analytics-worker` (aquí, un
// worker falso) a partir del archivo de entrada que prepara `api`.

let app: FastifyInstance;
let ana: TestUser;
let keyPrefix: string;
let worker: ReturnType<typeof startFakeExportWorker>;
let analysisWorker: ReturnType<typeof startFakeAnalysisWorker>;
let handler: ExportHandler;
const ok: ExportHandler = async () => ({});

beforeAll(async () => {
  let dbName: string;
  ({ app, dbName } = await buildTestApp('exportspdf', {
    withAuth: true,
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana Pérez');
  keyPrefix = `test-${dbName}:`;
  worker = startFakeExportWorker(`${keyPrefix}bull`, (...args) => handler(...args));
  analysisWorker = startFakeAnalysisWorker(`${keyPrefix}bull`);
});
beforeEach(async () => {
  handler = ok;
  await writeExportHeartbeat(keyPrefix);
});
afterAll(async () => {
  await worker.close();
  await analysisWorker.close();
  await closeTestApp(app);
});

const headers = () => authHeaders(ana);

async function project(details = 2) {
  const projectId = await seedProject(app, {
    name: 'Tienda demo',
    status: 'open',
    members: [[ana, 'admin']],
  });
  const diagram = await publishedDiagram(app, headers(), projectId);
  for (let index = 0; index < details; index++) {
    await detailsModel(app.mongo).create({
      projectId: new Types.ObjectId(projectId),
      diagramId: new Types.ObjectId(diagram.diagramId),
      activityKey: diagram.keys['Validar pago']!,
      given: `el cliente tiene el pedido ${index}`,
      when: 'paga con tarjeta',
      then: 'el sistema confirma el pago',
      type: 'functional',
      authorRole: 'Cajero',
      status: index === 0 ? 'validated' : 'pending',
      authorId: new Types.ObjectId(ana.id),
    });
  }
  return { projectId, ...diagram };
}

const request = (projectId: string, payload: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: `/projects/${projectId}/exports`,
    headers: headers(),
    payload: { format: 'pdf', ...payload },
  });
const statusOf = async (id: string) =>
  (await app.inject({ url: `/exports/${id}`, headers: headers() })).json<{
    status: string;
    [key: string]: unknown;
  }>();
async function finished(id: string) {
  await vi.waitFor(async () => expect((await statusOf(id)).status).toMatch(/^(done|failed)$/), {
    timeout: 10_000,
    interval: 50,
  });
  return statusOf(id);
}
const receivedFor = (id: string) => worker.received.find((item) => item.data.exportId === id)!;

describe('reporte PDF', () => {
  it('202; el worker recibe la entrada, sube el PDF y la descarga lo sirve', async () => {
    const { projectId, diagramId, keys } = await project();
    const filters = { statuses: ['pending', 'validated'] };
    const response = await request(projectId, { filters });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      format: 'pdf',
      mode: 'async',
      status: 'pending',
      detailCount: 2,
      bytes: null,
    });
    expect(response.json().fileName).toMatch(/^reqcanvas-tienda-demo-\d{8}-\d{4}\.pdf$/);
    const { id } = response.json<{ id: string }>();

    const done = await finished(id);
    expect(done).toMatchObject({ status: 'done', bytes: FAKE_PDF.length, error: null });
    const ttl = Date.parse(done.expiresAt as string) - Date.parse(done.finishedAt as string);
    expect(ttl).toBe(24 * 60 * 60 * 1000);

    // El job cumple el contrato y la entrada es la del proyecto.
    const { data, input } = receivedFor(id);
    expect(ExportJobInputSchema.safeParse(data).error?.issues ?? []).toEqual([]);
    expect(data).toMatchObject({ v: 1, exportId: id, projectId });
    expect(ExportInputFileSchema.safeParse(input).error?.issues ?? []).toEqual([]);
    expect(input.project).toEqual({ name: 'Tienda demo', timezone: 'America/Guayaquil' });
    expect(input.filters.statuses).toEqual(['pending', 'validated']);
    expect(input.analysis).toBeNull();

    // La misma instantánea que el dashboard con esos filtros (SC-004).
    const dashboard = await app.inject({
      url: `/projects/${projectId}/dashboard/descriptive?statuses=pending,validated`,
      headers: headers(),
    });
    expect(dashboard.statusCode).toBe(200);
    expect(input.descriptive).toEqual(dashboard.json());
    expect(input.descriptive.kpis.totalDetails).toBe(2);

    // Los diagramas publicados, con sus actividades y la imagen por una URL firmada.
    expect(input.diagrams).toHaveLength(1);
    const [diagram] = input.diagrams;
    expect(diagram!.id).toBe(diagramId);
    expect(diagram!.activities.map((activity) => activity.label).sort()).toEqual([
      'Emitir factura',
      'Enviar pedido',
      'Validar pago',
    ]);
    expect(
      diagram!.activities.find((activity) => activity.key === keys['Validar pago'])!.detailCount,
    ).toBe(2);
    const image = await fetch(diagram!.image.url);
    expect(image.status).toBe(200);
    expect(diagram!.image.width).toBeGreaterThan(0);

    // Sin nombres ni identificadores de personas.
    expect(input.details).toHaveLength(2);
    expect(input.details[0]).toMatchObject({
      authorRole: 'Cajero',
      activityKey: keys['Validar pago'],
    });
    const raw = JSON.stringify(input);
    expect(raw).not.toContain(ana.id);
    expect(raw).not.toContain('Ana Pérez');
    expect(raw).not.toContain('authorId');

    // La entrada se borra al terminar y el PDF se descarga a través de api.
    const stored = await exportsModel(app.mongo).findById(id).lean<ExportDoc>();
    expect(stored!.fileKey).toBe(`projects/${projectId}/exports/${id}.pdf`);
    expect(stored!.analysisRunId).toBeNull();
    expect(await app.storage.listKeys(`projects/${projectId}/exports/`)).toEqual([
      `projects/${projectId}/exports/${id}.pdf`,
    ]);
    const file = await app.inject({ url: `/exports/${id}/download`, headers: headers() });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toBe(`attachment; filename="${done.fileName}"`);
    expect(file.rawPayload.equals(FAKE_PDF)).toBe(true);
  });

  it('lleva el último análisis terminado tal como lo muestra el dashboard', async () => {
    const { projectId } = await project();
    const launched = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/analysis-runs`,
      headers: headers(),
      payload: {},
    });
    expect(launched.statusCode).toBe(202);
    const runId = launched.json<{ id: string }>().id;
    await vi.waitFor(
      async () =>
        expect(
          (await app.inject({ url: `/analysis-runs/${runId}`, headers: headers() })).json().status,
        ).toBe('done'),
      { timeout: 10_000, interval: 50 },
    );
    // Un par de duplicados ya decidido y un insight marcado como no útil no se exportan.
    const pair = [...EXAMPLE_RESULTS.duplicates![0]!.pair].sort();
    await duplicateDecisionsModel(app.mongo).create({
      projectId: new Types.ObjectId(projectId),
      pair,
      decision: 'rejected',
      decidedBy: new Types.ObjectId(ana.id),
    });
    const insight = EXAMPLE_RESULTS.insights![0]!;
    await insightFeedbackModel(app.mongo).create({
      projectId: new Types.ObjectId(projectId),
      runId: new Types.ObjectId(runId),
      insightId: insight.id,
      useful: false,
      statement: insight.statement,
      userId: new Types.ObjectId(ana.id),
    });

    const { id } = (await request(projectId)).json<{ id: string }>();
    expect((await finished(id)).status).toBe('done');
    const { analysis } = receivedFor(id).input;
    expect(analysis).not.toBeNull();
    expect(analysis!.stages).toEqual(EXAMPLE_RESULTS.stages);
    expect(analysis!.results.topics).toEqual(EXAMPLE_RESULTS.topics);
    expect(analysis!.results.duplicates).toEqual([]);
    expect(analysis!.results.insights).toEqual([]);
    expect(Date.parse(analysis!.finishedAt)).not.toBeNaN();
    const stored = await exportsModel(app.mongo).findById(id).lean<ExportDoc>();
    expect(stored!.analysisRunId!.toHexString()).toBe(runId);
  });

  it('sin detalles, el PDF se genera con detailCount 0', async () => {
    const { projectId } = await project(0);
    const response = await request(projectId);
    expect(response.statusCode).toBe(202);
    expect(response.json().detailCount).toBe(0);
    const { id } = response.json<{ id: string }>();
    expect((await finished(id)).status).toBe('done');
    expect(receivedFor(id).input.details).toEqual([]);
    expect(receivedFor(id).input.descriptive.kpis.totalDetails).toBe(0);
  });

  it('con el filtro de diagramas solo viajan los elegidos', async () => {
    const { projectId, diagramId } = await project();
    const other = await publishedDiagram(app, headers(), projectId);
    const { id } = (await request(projectId, { filters: { diagramIds: [other.diagramId] } })).json<{
      id: string;
    }>();
    await finished(id);
    const { input } = receivedFor(id);
    expect(input.diagrams.map((diagram) => diagram.id)).toEqual([other.diagramId]);
    expect(input.details).toEqual([]);
    expect(diagramId).not.toBe(other.diagramId);
  });
});

describe('errores', () => {
  it('422 NO_DIAGRAMS sin diagramas publicados', async () => {
    const projectId = await seedProject(app, { status: 'open', members: [[ana, 'admin']] });
    const response = await request(projectId);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      code: 'NO_DIAGRAMS',
      message: 'El reporte necesita al menos un diagrama publicado.',
    });
    expect(await exportsModel(app.mongo).countDocuments({ projectId })).toBe(0);
  });

  it('503 WORKER_UNAVAILABLE sin latido; /health/deep lo refleja en export-worker', async () => {
    const { projectId } = await project();
    const check = async () =>
      (await app.inject({ url: '/health/deep' })).json().checks['export-worker'];
    expect((await check()).status).toBe('up');

    await clearExportHeartbeat(keyPrefix);
    const response = await request(projectId);
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('WORKER_UNAVAILABLE');
    expect(await exportsModel(app.mongo).countDocuments({ projectId })).toBe(0);
    expect(await check()).toMatchObject({ status: 'down', error: 'Error' });
  });

  it('409 EXPORT_IN_PROGRESS con un PDF en curso', async () => {
    const { projectId } = await project();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    handler = async () => {
      await gate;
      return {};
    };
    const first = await request(projectId);
    expect(first.statusCode).toBe(202);
    const { id } = first.json<{ id: string }>();
    await vi.waitFor(async () => expect((await statusOf(id)).status).toBe('running'), {
      timeout: 5000,
      interval: 50,
    });
    const second = await request(projectId);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('EXPORT_IN_PROGRESS');
    // Otro formato sí se puede pedir mientras tanto.
    expect((await request(projectId, { format: 'csv' })).statusCode).toBe(200);
    release();
    expect((await finished(id)).status).toBe('done');
  });

  it('un fallo del worker queda failed con su código y borra la entrada', async () => {
    const { projectId } = await project();
    handler = async () => ({
      pdf: null,
      summary: { v: 1, status: 'failed', error: { code: 'OUTPUT_UPLOAD_FAILED', message: 'x' } },
    });
    const { id } = (await request(projectId)).json<{ id: string }>();
    const failed = await finished(id);
    expect(failed).toMatchObject({
      status: 'failed',
      bytes: null,
      expiresAt: null,
      error: {
        code: 'OUTPUT_UPLOAD_FAILED',
        message: 'No se pudo guardar el reporte. Vuelve a intentarlo.',
      },
    });
    await vi.waitFor(async () =>
      expect(await app.storage.listKeys(`projects/${projectId}/exports/`)).toEqual([]),
    );
    const file = await app.inject({ url: `/exports/${id}/download`, headers: headers() });
    expect(file.statusCode).toBe(410);
  });

  it.each([
    ['un retorno inválido', async () => ({ summary: { v: 1, status: 'done', bytes: 0 } })],
    [
      'una excepción del worker',
      async () => {
        throw new Error('detalle interno');
      },
    ],
  ] satisfies Array<[string, ExportHandler]>)(
    '%s queda failed con EXPORT_FAILED',
    async (_name, reply) => {
      const { projectId } = await project();
      handler = reply;
      const { id } = (await request(projectId)).json<{ id: string }>();
      expect((await finished(id)).error).toEqual({
        code: 'EXPORT_FAILED',
        message: 'No se pudo generar el reporte. Vuelve a intentarlo.',
      });
    },
  );

  it('si el worker no responde a tiempo queda failed con TIMEOUT', async () => {
    const { projectId } = await project();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    handler = async () => {
      await gate;
      return {};
    };
    const { id } = (await request(projectId)).json<{ id: string }>();
    expect(await app.exportPdf.sweep()).toEqual([]);
    // `createdAt` es inmutable en el modelo: se retrasa directamente en la colección.
    await exportsModel(app.mongo).collection.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { createdAt: new Date(Date.now() - 3_600_000) } },
    );
    expect(await app.exportPdf.sweep()).toEqual([id]);
    expect(await statusOf(id)).toMatchObject({
      status: 'failed',
      error: { code: 'TIMEOUT' },
    });
    // Si el worker termina después, la exportación sigue fallida.
    release();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await statusOf(id)).status).toBe('failed');
  });
});
