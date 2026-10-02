import type { DetectionJobInput, DetectionResult, DomainEventName } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { EXAMPLE_RESULT, startFakeWorker, writeHeartbeat } from '../helpers/detection-worker';
import { uploadDiagram } from '../helpers/diagrams';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US1 de la 006 (FR-001, FR-002, FR-003, FR-008, FR-009; plan, ajustes 1, 4, 7 y 10): ciclo del
// job con un worker falso en Node que consume la cola como `analytics-worker`.

let app: FastifyInstance;
let dbName: string;
let ana: TestUser;
let pablo: TestUser;
let worker: ReturnType<typeof startFakeWorker>;
const behaviours = new Map<string, (data: DetectionJobInput) => Promise<DetectionResult>>();
const events: Array<{ name: DomainEventName; payload: Record<string, unknown> }> = [];

const empty: DetectionResult = {
  v: 1,
  activities: [],
  transitions: [],
  stats: { durationMs: 12, llmUsed: false, ocrMeanConfidence: null },
};

beforeAll(async () => {
  ({ app, dbName } = await buildTestApp('detection', {
    withAuth: true,
    detection: { timeoutMs: 1500, sweepIntervalMs: 150 },
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  pablo = await registerTestUser(app, 'Pablo');
  app.domainEvents.onAny((name, payload) => {
    events.push({ name, payload: payload as Record<string, unknown> });
  });
  worker = startFakeWorker(`test-${dbName}:bull`, async (data, job) => {
    const behaviour = behaviours.get(data.versionId);
    if (behaviour) return behaviour(data);
    await job.updateProgress({ stage: 'ocr', pct: 55 });
    return EXAMPLE_RESULT;
  });
});
afterAll(async () => {
  await worker.close();
  await closeTestApp(app);
});

async function draft(status: 'open' | 'closed' = 'open') {
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [pablo, 'participant'],
    ],
  });
  const version = (await uploadDiagram(app, authHeaders(ana), projectId)).json();
  if (status === 'closed') {
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/status`,
      headers: authHeaders(ana),
      payload: { action: 'close' },
    });
  }
  return { projectId, versionId: version.id as string };
}

const start = (versionId: string, user = ana, payload: object = {}) =>
  app.inject({
    method: 'POST',
    url: `/diagram-versions/${versionId}/detections`,
    headers: authHeaders(user),
    payload,
  });

const latest = (versionId: string, user = ana) =>
  app.inject({ url: `/diagram-versions/${versionId}/detections`, headers: authHeaders(user) });

async function finished(versionId: string) {
  let job: Record<string, unknown> = {};
  await vi.waitFor(
    async () => {
      job = (await latest(versionId)).json();
      expect(job.status).toMatch(/^(done|failed)$/);
    },
    { timeout: 5000, interval: 50 },
  );
  return job;
}

const proposals = async (versionId: string) =>
  (
    await app.inject({ url: `/diagram-versions/${versionId}/proposals`, headers: authHeaders(ana) })
  ).json();

describe('iniciar la detección', () => {
  it('solo el Administrador y solo sobre un borrador de un proyecto abierto', async () => {
    const { versionId } = await draft();
    // Un miembro sin el rol necesario recibe 403, como en las rutas de la 003 y la 004.
    expect((await start(versionId, pablo)).statusCode).toBe(403);
    expect((await latest(versionId, pablo)).statusCode).toBe(403);

    const closed = await draft('closed');
    expect((await start(closed.versionId)).statusCode).toBe(409);
  });

  it('sobre una versión publicada → 409', async () => {
    const { versionId } = await draft();
    await app.inject({
      method: 'POST',
      url: `/diagram-versions/${versionId}/activities`,
      headers: authHeaders(ana),
      payload: { label: 'Validar pago', type: 'action', bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
    });
    await app.inject({
      method: 'POST',
      url: `/diagram-versions/${versionId}/publish`,
      headers: authHeaders(ana),
    });
    const response = await start(versionId);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('VERSION_NOT_DRAFT');
  });

  it('sin detecciones, la última responde 404', async () => {
    const { versionId } = await draft();
    expect((await latest(versionId)).statusCode).toBe(404);
  });

  it('con un job activo, otro POST → 409; al terminar se puede volver a lanzar', async () => {
    const { versionId } = await draft();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    behaviours.set(versionId, async () => {
      await gate;
      return empty;
    });
    const first = await start(versionId);
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ status: 'pending', versionId });
    const second = await start(versionId);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      code: 'DETECTION_IN_PROGRESS',
      message: 'Ya hay una detección en curso para esta versión.',
    });
    release();
    await finished(versionId);
    expect((await start(versionId)).statusCode).toBe(202);
    await finished(versionId);
  });
});

describe('ciclo del job', () => {
  it('pending → running → done: progreso, propuestas, métricas y eventos', async () => {
    const { projectId, versionId } = await draft();
    events.length = 0;
    const response = await start(versionId, ana, { llmRefine: true });
    const jobId = response.json().id as string;
    const job = await finished(versionId);
    expect(job).toMatchObject({
      id: jobId,
      status: 'done',
      progress: { pct: 100 },
      error: null,
      metrics: {
        proposed: 3,
        accepted: 0,
        edited: 0,
        discarded: 0,
        durationMs: 18450,
        llmUsed: true,
      },
    });

    const { activities, transitions } = await proposals(versionId);
    expect(activities).toHaveLength(3);
    expect(activities.map((a: { label: string }) => a.label)).toEqual([
      '',
      'Validar pago',
      'Emitir factura',
    ]);
    expect(
      Object.fromEntries(
        activities.map((a: { label: string; confidenceLevel: string }) => [
          a.label,
          a.confidenceLevel,
        ]),
      ),
    ).toEqual({ '': 'high', 'Validar pago': 'high', 'Emitir factura': 'medium' });
    expect(
      activities.every(
        (a: { status: string; jobId: string }) => a.status === 'pending' && a.jobId === jobId,
      ),
    ).toBe(true);
    expect(transitions).toHaveLength(2);

    const names = events.map((event) => event.name);
    expect(names).toContain('detection.progress');
    expect(names.at(-1)).toBe('detection.completed');
    expect(events.find((event) => event.name === 'detection.progress')?.payload).toMatchObject({
      projectId,
      versionId,
      jobId,
      stage: 'ocr',
      pct: 55,
    });
    expect(events.at(-1)?.payload).toMatchObject({ jobId, proposed: 3 });
  });

  it('el worker recibe la URL firmada de la imagen display y las opciones', async () => {
    const { versionId } = await draft();
    await start(versionId, ana, { llmRefine: true, arrows: false });
    await finished(versionId);
    const data = worker.received.find((item) => item.versionId === versionId)!;
    expect(data).toMatchObject({
      v: 1,
      options: { llmRefine: false, arrows: false, languages: ['spa', 'eng'] },
    });
    expect(data.image.url).toContain('X-Amz-Signature=');
    expect(data.image.url).toContain('display');
    expect((await fetch(data.image.url)).status).toBe(200);
    expect(data.requestId).toBeTruthy();
  });

  it('las que se superponen con actividades existentes son posibles duplicados', async () => {
    const { versionId } = await draft();
    await app.inject({
      method: 'POST',
      url: `/diagram-versions/${versionId}/activities`,
      headers: authHeaders(ana),
      payload: {
        label: 'Validar pago',
        type: 'action',
        bbox: { x: 0.12, y: 0.3, w: 0.15, h: 0.06 },
      },
    });
    await start(versionId);
    await finished(versionId);
    const { activities } = await proposals(versionId);
    const byLabel = Object.fromEntries(
      activities.map((a: { label: string; flags: string[] }) => [a.label, a.flags]),
    );
    expect(byLabel['Validar pago']).toEqual(['llm_corrected', 'possible_duplicate']);
    expect(byLabel['Emitir factura']).toEqual([]);
  });

  it('sin formas reconocibles termina con 0 propuestas', async () => {
    const { versionId } = await draft();
    behaviours.set(versionId, async () => empty);
    await start(versionId);
    const job = await finished(versionId);
    expect(job).toMatchObject({ status: 'done', metrics: { proposed: 0 } });
    expect((await proposals(versionId)).activities).toEqual([]);
  });

  it('un fallo del worker deja failed con un mensaje en español sin detalles internos', async () => {
    const { versionId } = await draft();
    events.length = 0;
    behaviours.set(versionId, async () => {
      throw new Error('IMAGE_DOWNLOAD_FAILED');
    });
    await start(versionId);
    expect(await finished(versionId)).toMatchObject({
      status: 'failed',
      error: {
        code: 'IMAGE_DOWNLOAD_FAILED',
        message: 'No se pudo leer la imagen del diagrama. Vuelve a intentarlo.',
      },
    });
    expect(events.at(-1)).toMatchObject({ name: 'detection.failed' });

    behaviours.set(versionId, async () => {
      throw new Error('stack interno en /app/x.py línea 3');
    });
    await start(versionId);
    expect((await finished(versionId)).error).toEqual({
      code: 'INTERNAL',
      message:
        'No se pudo completar la detección. Vuelve a intentarlo o marca las zonas manualmente.',
    });
  });

  it('un resultado que no cumple el contrato se descarta como fallo interno', async () => {
    const { versionId } = await draft();
    behaviours.set(versionId, async () => ({ ...empty, v: 2 }) as unknown as DetectionResult);
    await start(versionId);
    expect(await finished(versionId)).toMatchObject({
      status: 'failed',
      error: { code: 'INTERNAL' },
    });
  });

  it('sin terminar en el tiempo máximo → failed con TIMEOUT, aunque el worker acabe después', async () => {
    const { versionId } = await draft();
    behaviours.set(versionId, async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return EXAMPLE_RESULT;
    });
    await start(versionId);
    expect(await finished(versionId)).toMatchObject({
      status: 'failed',
      error: { code: 'TIMEOUT' },
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await latest(versionId)).json().status).toBe('failed');
    expect((await proposals(versionId)).activities).toEqual([]);
  });

  it('volver a detectar reemplaza las propuestas pendientes anteriores', async () => {
    const { versionId } = await draft();
    await start(versionId);
    await finished(versionId);
    const before = (await proposals(versionId)).activities.map((a: { id: string }) => a.id);
    await start(versionId);
    await finished(versionId);
    const after = (await proposals(versionId)).activities.map((a: { id: string }) => a.id);
    expect(after).toHaveLength(3);
    expect(after.some((id: string) => before.includes(id))).toBe(false);
    const superseded = await app.mongo
      .collection('activity_proposals')
      .countDocuments({ versionId: { $exists: true }, status: 'superseded' });
    expect(superseded).toBeGreaterThanOrEqual(3);
  });
});

describe('salud', () => {
  it('/health/deep informa detection-worker según el latido', async () => {
    const check = async () =>
      (await app.inject({ url: '/health/deep' })).json().checks['detection-worker'];
    expect(await check()).toMatchObject({ status: 'down', error: 'Error' });
    await writeHeartbeat(`test-${dbName}:`);
    expect(await check()).toMatchObject({ status: 'up' });
  });
});
