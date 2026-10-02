import type { DetectionResult } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { EXAMPLE_RESULT, startFakeWorker } from '../helpers/detection-worker';
import { uploadDiagram } from '../helpers/diagrams';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US3 de la 006 (FR-004, FR-007): flechas propuestas. El resultado de ejemplo propone
// inicio → «Validar pago» → «Emitir factura».

let app: FastifyInstance;
let dbName: string;
let ana: TestUser;
let pablo: TestUser;
let worker: ReturnType<typeof startFakeWorker>;

beforeAll(async () => {
  ({ app, dbName } = await buildTestApp('transitions', {
    withAuth: true,
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  pablo = await registerTestUser(app, 'Pablo');
  worker = startFakeWorker(`test-${dbName}:bull`, async () => EXAMPLE_RESULT as DetectionResult);
});
afterAll(async () => {
  await worker.close();
  await closeTestApp(app);
});

const as = (user: TestUser) => authHeaders(user);

async function detect(versionId: string) {
  await app.inject({
    method: 'POST',
    url: `/diagram-versions/${versionId}/detections`,
    headers: as(ana),
    payload: {},
  });
  await vi.waitFor(
    async () => {
      const job = (
        await app.inject({ url: `/diagram-versions/${versionId}/detections`, headers: as(ana) })
      ).json();
      expect(job.status).toBe('done');
    },
    { timeout: 5000, interval: 50 },
  );
}

async function detected() {
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [pablo, 'participant'],
    ],
  });
  const versionId = (await uploadDiagram(app, as(ana), projectId)).json().id as string;
  await detect(versionId);
  return { projectId, versionId };
}

type Body = {
  activities: Array<{ id: string; label: string; type: string }>;
  transitions: Array<{
    id: string;
    from: { label: string; status: string; bbox: object };
    to: { label: string; status: string };
  }>;
};

async function proposals(versionId: string) {
  const body = (
    await app.inject({ url: `/diagram-versions/${versionId}/proposals`, headers: as(ana) })
  ).json() as Body;
  const id = (label: string) => body.activities.find((a) => (a.label || a.type) === label)!.id;
  const arrow = (from: string, to: string) =>
    body.transitions.find((t) => (t.from.label || 'start') === from && t.to.label === to)!;
  return { ...body, id, arrow };
}

const post = (url: string, user = ana) =>
  app.inject({ method: 'POST', url, headers: as(user), payload: {} });
const activities = async (versionId: string) =>
  (await app.inject({ url: `/diagram-versions/${versionId}`, headers: as(ana) })).json()
    .activities as Array<{ label: string; key: string; next: string[] }>;

describe('transiciones propuestas', () => {
  it('llegan con el nombre, la zona y el estado de sus extremos', async () => {
    const { versionId } = await detected();
    const { transitions } = await proposals(versionId);
    expect(transitions).toHaveLength(2);
    expect(transitions.map((t) => `${t.from.label || 'inicio'} → ${t.to.label}`).sort()).toEqual([
      'Validar pago → Emitir factura',
      'inicio → Validar pago',
    ]);
    expect(transitions[0]!.from).toMatchObject({ status: 'pending', bbox: expect.any(Object) });
  });

  it('aceptar exige las dos actividades aceptadas y añade la key destino al next del origen', async () => {
    const { versionId } = await detected();
    const before = await proposals(versionId);
    const arrow = before.arrow('Validar pago', 'Emitir factura');
    const early = await post(`/transition-proposals/${arrow.id}/accept`);
    expect(early.statusCode).toBe(422);
    expect(early.json()).toMatchObject({
      code: 'ENDS_NOT_ACCEPTED',
      message: 'Acepta antes las dos actividades que une esta flecha.',
    });

    await post(`/proposals/${before.id('Validar pago')}/accept`);
    await post(`/proposals/${before.id('Emitir factura')}/accept`);
    const after = await proposals(versionId);
    expect(after.arrow('Validar pago', 'Emitir factura').from.status).toBe('accepted');
    expect((await post(`/transition-proposals/${arrow.id}/accept`)).statusCode).toBe(200);

    const byLabel = Object.fromEntries((await activities(versionId)).map((a) => [a.label, a]));
    expect(byLabel['Validar pago']!.next).toEqual([byLabel['Emitir factura']!.key]);
    expect((await proposals(versionId)).transitions).toHaveLength(1);
    expect((await post(`/transition-proposals/${arrow.id}/accept`)).statusCode).toBe(409);
  });

  it('descartar no la añade', async () => {
    const { versionId } = await detected();
    const { id, arrow } = await proposals(versionId);
    await post(`/proposals/${id('Validar pago')}/accept`);
    await post(`/proposals/${id('Emitir factura')}/accept`);
    const response = await post(
      `/transition-proposals/${arrow('Validar pago', 'Emitir factura').id}/discard`,
    );
    expect(response.statusCode).toBe(204);
    expect((await activities(versionId)).every((a) => a.next.length === 0)).toBe(true);
  });

  it('cuentan como pendientes al publicar', async () => {
    const { versionId } = await detected();
    const { id } = await proposals(versionId);
    for (const label of ['start', 'Validar pago', 'Emitir factura']) {
      await post(`/proposals/${id(label)}/accept`);
    }
    const blocked = await post(`/diagram-versions/${versionId}/publish`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json()).toMatchObject({ code: 'PENDING_PROPOSALS', pending: 2 });
  });

  it('volver a detectar las reemplaza', async () => {
    const { versionId } = await detected();
    const before = (await proposals(versionId)).transitions.map((t) => t.id);
    await detect(versionId);
    const after = (await proposals(versionId)).transitions.map((t) => t.id);
    expect(after).toHaveLength(2);
    expect(after.some((id) => before.includes(id))).toBe(false);
  });

  it('el Participante → 403', async () => {
    const { versionId } = await detected();
    const { transitions } = await proposals(versionId);
    expect(
      (await post(`/transition-proposals/${transitions[0]!.id}/accept`, pablo)).statusCode,
    ).toBe(403);
    expect(
      (await post(`/transition-proposals/${transitions[0]!.id}/discard`, pablo)).statusCode,
    ).toBe(403);
  });
});
