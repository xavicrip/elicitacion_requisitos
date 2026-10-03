import {
  ActivitySchema,
  DetectionJobSchema,
  ProposalsSchema,
  TransitionProposalSchema,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { EXAMPLE_RESULT, startFakeWorker } from '../helpers/detection-worker';
import { uploadDiagram } from '../helpers/diagrams';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser } from '../helpers/users';

// Contrato: specs/006-deteccion-asistida/contracts/detection.openapi.yaml (respuestas estrictas:
// ningún campo fuera del contrato compartido en `packages/shared`).

let app: FastifyInstance;
let admin: Record<string, string>;
let versionId: string;
let adminProject: string;
let worker: ReturnType<typeof startFakeWorker>;

beforeAll(async () => {
  let dbName: string;
  ({ app, dbName } = await buildTestApp('detectioncontract', {
    withAuth: true,
  }));
  await app.ready();
  worker = startFakeWorker(`test-${dbName}:bull`, async () => EXAMPLE_RESULT);
  const user = await registerTestUser(app);
  admin = authHeaders(user);
  adminProject = await seedProject(app, { status: 'open', members: [[user, 'admin']] });
  versionId = (await uploadDiagram(app, admin, adminProject)).json().id;
});
afterAll(async () => {
  await worker.close();
  await closeTestApp(app);
});

const JobSchema = DetectionJobSchema.strict();

describe('/diagram-versions/{versionId}/detections', () => {
  it('POST 202 y GET 200 devuelven un DetectionJob', async () => {
    const started = await app.inject({
      method: 'POST',
      url: `/diagram-versions/${versionId}/detections`,
      headers: admin,
      payload: { llmRefine: false, arrows: true },
    });
    expect(started.statusCode).toBe(202);
    expect(JobSchema.safeParse(started.json()).error?.issues ?? []).toEqual([]);

    await vi.waitFor(
      async () => {
        const latest = await app.inject({
          url: `/diagram-versions/${versionId}/detections`,
          headers: admin,
        });
        expect(latest.statusCode).toBe(200);
        expect(JobSchema.parse(latest.json()).status).toBe('done');
      },
      { timeout: 5000, interval: 50 },
    );
  });

  it('POST sin cuerpo usa los valores por defecto', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/diagram-versions/${versionId}/detections`,
      headers: admin,
    });
    expect(response.statusCode, response.body).toBe(202);
    const jobId = response.json().id;
    await vi.waitFor(
      async () => {
        const latest = (
          await app.inject({ url: `/diagram-versions/${versionId}/detections`, headers: admin })
        ).json();
        expect(latest).toMatchObject({ id: jobId, status: 'done' });
      },
      { timeout: 5000, interval: 50 },
    );
  });
});

describe('/diagram-versions/{versionId}/proposals', () => {
  it('GET 200 devuelve las propuestas pendientes de actividades y transiciones', async () => {
    const response = await app.inject({
      url: `/diagram-versions/${versionId}/proposals`,
      headers: admin,
    });
    expect(response.statusCode).toBe(200);
    const body = ProposalsSchema.parse(response.json());
    expect(body.activities.length).toBeGreaterThan(0);
    for (const proposal of response.json().activities) {
      expect(Object.keys(proposal).sort()).toEqual(
        [
          'activityId',
          'bbox',
          'confidence',
          'confidenceLevel',
          'flags',
          'id',
          'jobId',
          'label',
          'status',
          'type',
          'versionId',
        ].sort(),
      );
    }
  });
});

describe('revisión de propuestas', () => {
  const pendingIds = async () =>
    (await app.inject({ url: `/diagram-versions/${versionId}/proposals`, headers: admin })).json()
      .activities as Array<{ id: string; label: string; confidenceLevel: string }>;

  it('POST /proposals/{id}/accept 200 devuelve la actividad creada (Activity de la 003)', async () => {
    const proposal = (await pendingIds()).find((p) => p.label === 'Emitir factura')!;
    const response = await app.inject({
      method: 'POST',
      url: `/proposals/${proposal.id}/accept`,
      headers: admin,
      payload: { label: 'Emitir la factura', type: 'action' },
    });
    expect(response.statusCode).toBe(200);
    expect(ActivitySchema.strict().safeParse(response.json()).error?.issues ?? []).toEqual([]);
  });

  it('POST /proposals/{id}/accept 422 con una acción sin nombre', async () => {
    const proposal = (await pendingIds()).find((p) => p.label === 'Validar pago')!;
    const response = await app.inject({
      method: 'POST',
      url: `/proposals/${proposal.id}/accept`,
      headers: admin,
      payload: { label: '   ' },
    });
    // Un nombre en blanco no pasa la validación del cuerpo (las mismas reglas que la 003).
    expect([400, 422]).toContain(response.statusCode);
  });

  it('POST /proposals/{id}/discard 204 sin cuerpo', async () => {
    const proposal = (await pendingIds()).find((p) => p.label === 'Validar pago')!;
    const response = await app.inject({
      method: 'POST',
      url: `/proposals/${proposal.id}/discard`,
      headers: admin,
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it('POST /diagram-versions/{id}/proposals/accept-high 200 devuelve { accepted }', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/diagram-versions/${versionId}/proposals/accept-high`,
      headers: admin,
    });
    expect(response.statusCode).toBe(200);
    expect(
      z
        .object({ accepted: z.number().int().min(0) })
        .strict()
        .parse(response.json()),
    ).toEqual({
      accepted: 1,
    });
  });
});

describe('transiciones propuestas', () => {
  it('GET proposals devuelve TransitionProposal con sus extremos; accept 200 y discard 204', async () => {
    const fresh = (await uploadDiagram(app, admin, adminProject)).json().id as string;
    await app.inject({
      method: 'POST',
      url: `/diagram-versions/${fresh}/detections`,
      headers: admin,
      payload: {},
    });
    let body: { activities: Array<{ id: string }>; transitions: Array<{ id: string }> } = {
      activities: [],
      transitions: [],
    };
    await vi.waitFor(
      async () => {
        body = (
          await app.inject({ url: `/diagram-versions/${fresh}/proposals`, headers: admin })
        ).json();
        expect(body.transitions).toHaveLength(2);
      },
      { timeout: 5000, interval: 50 },
    );
    for (const transition of body.transitions) {
      expect(TransitionProposalSchema.strict().safeParse(transition).error?.issues ?? []).toEqual(
        [],
      );
    }
    expect(body.activities).toHaveLength(3);
    for (const activity of body.activities) {
      const response = await app.inject({
        method: 'POST',
        url: `/proposals/${activity.id}/accept`,
        headers: admin,
        payload: {},
      });
      // Si una aceptación falla, la flecha respondería 422: se comprueba aquí con su motivo.
      expect(response.statusCode, response.body).toBe(200);
    }
    const [first, second] = body.transitions;
    const accepted = await app.inject({
      method: 'POST',
      url: `/transition-proposals/${first!.id}/accept`,
      headers: admin,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const discarded = await app.inject({
      method: 'POST',
      url: `/transition-proposals/${second!.id}/discard`,
      headers: admin,
    });
    expect(discarded.statusCode).toBe(204);
  });
});
