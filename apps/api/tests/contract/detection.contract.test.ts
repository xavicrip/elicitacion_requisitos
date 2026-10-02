import { DetectionJobSchema, ProposalsSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
let worker: ReturnType<typeof startFakeWorker>;

beforeAll(async () => {
  let dbName: string;
  ({ app, dbName } = await buildTestApp('detectioncontract', {
    withAuth: true,
    featureFlags: 'detection=true',
  }));
  await app.ready();
  worker = startFakeWorker(`test-${dbName}:bull`, async () => EXAMPLE_RESULT);
  const user = await registerTestUser(app);
  admin = authHeaders(user);
  const projectId = await seedProject(app, { status: 'open', members: [[user, 'admin']] });
  versionId = (await uploadDiagram(app, admin, projectId)).json().id;
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
