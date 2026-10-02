import {
  AnalysisRunSchema,
  AnalysisSettingsSchema,
  DescriptiveDashboardSchema,
  DuplicateDecisionSchema,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { startFakeAnalysisWorker } from '../helpers/analysis-worker';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { createDetail, publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser } from '../helpers/users';

// Contrato: specs/007-dashboard-analitico/contracts/dashboard.openapi.yaml (respuestas estrictas:
// ningún campo fuera del contrato compartido en `packages/shared`). Cada historia añade aquí sus
// rutas (constitución III).

let app: FastifyInstance;
let admin: Record<string, string>;
let projectId: string;
let worker: ReturnType<typeof startFakeAnalysisWorker>;

beforeAll(async () => {
  let dbName: string;
  ({ app, dbName } = await buildTestApp('dashboardcontract', {
    withAuth: true,
    featureFlags: 'dashboard=true',
  }));
  await app.ready();
  worker = startFakeAnalysisWorker(`test-${dbName}:bull`);
  const user = await registerTestUser(app);
  admin = authHeaders(user);
  projectId = await seedProject(app, { status: 'open', members: [[user, 'admin']] });
  const diagram = await publishedDiagram(app, admin, projectId);
  await createDetail(app, admin, diagram.diagramId, diagram.keys['Validar pago']!);
});
afterAll(async () => {
  await worker.close();
  await closeTestApp(app);
});

const Count = z.strictObject({ key: z.string(), label: z.string(), count: z.number().int() });
const StrictDescriptive = z.strictObject({
  kpis: z.strictObject(DescriptiveDashboardSchema.shape.kpis.shape),
  byActivity: z.array(Count),
  byType: z.array(Count),
  byPriority: z.array(Count),
  byRole: z.array(Count),
  byStatus: z.array(Count),
  timeline: z.array(z.strictObject(DescriptiveDashboardSchema.shape.timeline.element.shape)),
});

describe('GET /projects/{projectId}/dashboard/descriptive', () => {
  it('200 cumple Descriptive (estricto)', async () => {
    const response = await app.inject({
      url: `/projects/${projectId}/dashboard/descriptive?type=non_functional&status=pending`,
      headers: admin,
    });
    expect(response.statusCode).toBe(200);
    expect(StrictDescriptive.safeParse(response.json()).error?.issues ?? []).toEqual([]);
    expect(response.json().kpis.totalDetails).toBe(1);
  });

  it('400 con un filtro inválido sigue el formato de errores', async () => {
    const response = await app.inject({
      url: `/projects/${projectId}/dashboard/descriptive?from=ayer`,
      headers: admin,
    });
    expect(response.statusCode).toBe(400);
    expect(
      z
        .strictObject({
          code: z.literal('VALIDATION_ERROR'),
          message: z.string(),
          fields: z.record(z.string(), z.string()),
        })
        .safeParse(response.json()).success,
    ).toBe(true);
  });
});

describe('análisis (US2)', () => {
  const StrictRun = z.strictObject(AnalysisRunSchema.shape);
  const ErrorBody = z.strictObject({ code: z.string(), message: z.string() });
  let runId: string;

  it('GET /projects/{projectId}/analysis-runs/latest 404 antes del primer análisis', async () => {
    const response = await app.inject({
      url: `/projects/${projectId}/analysis-runs/latest`,
      headers: admin,
    });
    expect(response.statusCode).toBe(404);
    expect(ErrorBody.safeParse(response.json()).success).toBe(true);
  });

  it('POST /projects/{projectId}/analysis-runs 202 devuelve AnalysisRun sin results', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/analysis-runs`,
      headers: admin,
      payload: { filters: { types: ['non_functional'] } },
    });
    expect(response.statusCode).toBe(202);
    expect(StrictRun.safeParse(response.json()).error?.issues ?? []).toEqual([]);
    expect(response.json()).not.toHaveProperty('results');
    runId = response.json().id;
  });

  it('GET /analysis-runs/{runId} 200 devuelve AnalysisRun con results al terminar', async () => {
    await vi.waitFor(
      async () => {
        const response = await app.inject({ url: `/analysis-runs/${runId}`, headers: admin });
        expect(response.statusCode).toBe(200);
        expect(StrictRun.safeParse(response.json()).error?.issues ?? []).toEqual([]);
        expect(response.json().status).toBe('done');
        expect(response.json().results.schemaVersion).toBe(1);
      },
      { timeout: 10_000, interval: 50 },
    );
  });

  it('GET /projects/{projectId}/analysis-runs 200 devuelve el historial sin results', async () => {
    const response = await app.inject({
      url: `/projects/${projectId}/analysis-runs`,
      headers: admin,
    });
    expect(response.statusCode).toBe(200);
    expect(z.array(StrictRun).safeParse(response.json()).error?.issues ?? []).toEqual([]);
    expect(response.json()[0]).not.toHaveProperty('results');
  });

  it('GET /projects/{projectId}/analysis-runs/latest 200 devuelve el último con results', async () => {
    const response = await app.inject({
      url: `/projects/${projectId}/analysis-runs/latest`,
      headers: admin,
    });
    expect(response.statusCode).toBe(200);
    expect(StrictRun.safeParse(response.json()).error?.issues ?? []).toEqual([]);
    expect(response.json().id).toBe(runId);
  });
});

describe('decisiones y ajustes (US3)', () => {
  it('POST /projects/{projectId}/duplicate-decisions 201 devuelve la decisión', async () => {
    const diagram = await publishedDiagram(app, admin, projectId, ['Otra actividad']);
    const ids: string[] = [];
    for (const given of ['el cliente paga', 'el comprador paga']) {
      const created = await createDetail(
        app,
        admin,
        diagram.diagramId,
        diagram.keys['Otra actividad']!,
        {
          given,
        },
      );
      ids.push(created.json().id);
    }
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/duplicate-decisions`,
      headers: admin,
      payload: { pair: ids, decision: 'rejected' },
    });
    expect(response.statusCode).toBe(201);
    expect(
      z.strictObject(DuplicateDecisionSchema.shape).safeParse(response.json()).error?.issues ?? [],
    ).toEqual([]);
  });

  it('GET y PUT /projects/{projectId}/analysis-settings 200 devuelven AnalysisSettings', async () => {
    const StrictSettings = z.strictObject({
      ...AnalysisSettingsSchema.shape,
      schedule: z.strictObject(AnalysisSettingsSchema.shape.schedule.shape),
    });
    const current = await app.inject({
      url: `/projects/${projectId}/analysis-settings`,
      headers: admin,
    });
    expect(current.statusCode).toBe(200);
    expect(StrictSettings.safeParse(current.json()).error?.issues ?? []).toEqual([]);
    const saved = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/analysis-settings`,
      headers: admin,
      payload: { ...(current.json() as object), extraAmbiguousTerms: ['ágil'] },
    });
    expect(saved.statusCode).toBe(200);
    expect(StrictSettings.safeParse(saved.json()).error?.issues ?? []).toEqual([]);
  });
});
