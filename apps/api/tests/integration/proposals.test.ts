import type { DetectionResult, DomainEventName } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { EXAMPLE_RESULT, startFakeWorker } from '../helpers/detection-worker';
import { uploadDiagram } from '../helpers/diagrams';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US2 de la 006 (FR-005, FR-006, FR-007, FR-008, FR-009): revisar las propuestas. El resultado
// de ejemplo trae «Validar pago» (alta), «Emitir factura» (media) y un inicio sin nombre (alta).

let app: FastifyInstance;
let dbName: string;
let ana: TestUser;
let pablo: TestUser;
let worker: ReturnType<typeof startFakeWorker>;
const results = new Map<string, DetectionResult>();
const events: Array<{ name: DomainEventName; payload: Record<string, unknown> }> = [];

const NO_TRANSITIONS: DetectionResult = { ...EXAMPLE_RESULT, transitions: [] };

beforeAll(async () => {
  ({ app, dbName } = await buildTestApp('proposals', {
    withAuth: true,
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  pablo = await registerTestUser(app, 'Pablo');
  app.domainEvents.onAny((name, payload) => {
    events.push({ name, payload: payload as Record<string, unknown> });
  });
  worker = startFakeWorker(
    `test-${dbName}:bull`,
    async (data) => results.get(data.versionId) ?? EXAMPLE_RESULT,
  );
});
afterAll(async () => {
  await worker.close();
  await closeTestApp(app);
});

const as = (user: TestUser) => authHeaders(user);

async function detected(result?: DetectionResult) {
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [pablo, 'participant'],
    ],
  });
  const versionId = (await uploadDiagram(app, as(ana), projectId)).json().id as string;
  if (result) results.set(versionId, result);
  await detect(versionId);
  return { projectId, versionId };
}

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

async function pending(versionId: string) {
  const body = (
    await app.inject({ url: `/diagram-versions/${versionId}/proposals`, headers: as(ana) })
  ).json();
  const byLabel = Object.fromEntries(
    body.activities.map((p: { label: string; type: string; id: string }) => [p.label || p.type, p]),
  ) as Record<string, { id: string; flags: string[] }>;
  return { ...body, byLabel };
}

const accept = (id: string, payload: object = {}, user = ana) =>
  app.inject({ method: 'POST', url: `/proposals/${id}/accept`, headers: as(user), payload });
const discard = (id: string, user = ana) =>
  app.inject({ method: 'POST', url: `/proposals/${id}/discard`, headers: as(user) });
const activitiesOf = async (versionId: string) =>
  (await app.inject({ url: `/diagram-versions/${versionId}`, headers: as(ana) })).json().activities;
const metrics = async (versionId: string) =>
  (await app.inject({ url: `/diagram-versions/${versionId}/detections`, headers: as(ana) })).json()
    .metrics;

describe('aceptar', () => {
  it('crea una actividad normal con source detected; con correcciones cuenta como editada', async () => {
    const { versionId } = await detected();
    const { byLabel } = await pending(versionId);
    events.length = 0;

    const response = await accept(byLabel['Emitir factura']!.id, { label: 'Emitir la factura' });
    expect(response.statusCode).toBe(200);
    const activity = response.json();
    expect(activity).toMatchObject({
      label: 'Emitir la factura',
      type: 'action',
      source: 'detected',
      rev: 0,
    });
    expect(activity.key).toMatch(/^[0-9a-f-]{36}$/);
    expect((await activitiesOf(versionId)).map((a: { label: string }) => a.label)).toEqual([
      'Emitir la factura',
    ]);
    expect((await pending(versionId)).byLabel['Emitir factura']).toBeUndefined();
    expect(await metrics(versionId)).toMatchObject({ proposed: 3, accepted: 1, edited: 1 });
    expect(events.at(-1)).toMatchObject({
      name: 'proposal.reviewed',
      payload: { kind: 'activity', status: 'accepted', activityId: activity.id, versionId },
    });
  });

  it('sin correcciones no cuenta como editada; aceptar dos veces → 409', async () => {
    const { versionId } = await detected();
    const id = (await pending(versionId)).byLabel['Validar pago']!.id;
    expect((await accept(id)).statusCode).toBe(200);
    const again = await accept(id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'PROPOSAL_NOT_PENDING' });
    expect(await metrics(versionId)).toMatchObject({ accepted: 1, edited: 0 });
  });

  it('un inicio sin nombre se acepta como «Inicio»; una acción sin nombre exige escribirlo', async () => {
    const unnamed: DetectionResult = {
      ...NO_TRANSITIONS,
      activities: [
        ...NO_TRANSITIONS.activities,
        {
          tempId: 'a9',
          bbox: { x: 0.6, y: 0.6, w: 0.2, h: 0.05 },
          type: 'action',
          label: '',
          confidence: 0.55,
          flags: ['empty_label'],
        },
      ],
    };
    const { versionId } = await detected(unnamed);
    const { byLabel } = await pending(versionId);
    expect((await accept(byLabel.start!.id)).json()).toMatchObject({
      label: 'Inicio',
      type: 'start',
    });
    const missing = await accept(byLabel.action!.id);
    expect(missing.statusCode).toBe(422);
    expect(missing.json()).toMatchObject({
      code: 'LABEL_REQUIRED',
      message: 'Escribe el nombre de la actividad antes de aceptarla.',
    });
    expect((await accept(byLabel.action!.id, { label: 'Confirmar envío' })).statusCode).toBe(200);
  });

  it('una corrección inválida (zona fuera de la imagen) → 400 y la propuesta sigue pendiente', async () => {
    const { versionId } = await detected();
    const id = (await pending(versionId)).byLabel['Validar pago']!.id;
    const response = await accept(id, { bbox: { x: 0.9, y: 0.1, w: 0.3, h: 0.1 } });
    expect(response.statusCode).toBe(400);
    expect((await pending(versionId)).byLabel['Validar pago']).toBeDefined();
  });
});

describe('descartar', () => {
  it('no crea actividad, cuenta en las métricas y descarta las flechas que la tocaban', async () => {
    const { versionId } = await detected();
    const before = await pending(versionId);
    expect(before.transitions).toHaveLength(2);
    expect((await discard(before.byLabel['Validar pago']!.id)).statusCode).toBe(204);
    const after = await pending(versionId);
    expect(after.byLabel['Validar pago']).toBeUndefined();
    expect(after.transitions).toEqual([]);
    expect(await activitiesOf(versionId)).toEqual([]);
    expect(await metrics(versionId)).toMatchObject({ discarded: 1, accepted: 0 });
    expect((await discard(before.byLabel['Validar pago']!.id)).statusCode).toBe(409);
  });
});

describe('aceptar en bloque', () => {
  it('acepta solo las de confianza alta y deja el resto pendiente', async () => {
    const { versionId } = await detected(NO_TRANSITIONS);
    const response = await app.inject({
      method: 'POST',
      url: `/diagram-versions/${versionId}/proposals/accept-high`,
      headers: as(ana),
    });
    expect(response.json()).toEqual({ accepted: 2 });
    expect((await activitiesOf(versionId)).map((a: { label: string }) => a.label).sort()).toEqual([
      'Inicio',
      'Validar pago',
    ]);
    expect(Object.keys((await pending(versionId)).byLabel)).toEqual(['Emitir factura']);
  });

  it('excluye los posibles duplicados', async () => {
    const projectId = await seedProject(app, { status: 'open', members: [[ana, 'admin']] });
    const versionId = (await uploadDiagram(app, as(ana), projectId)).json().id as string;
    results.set(versionId, NO_TRANSITIONS);
    await app.inject({
      method: 'POST',
      url: `/diagram-versions/${versionId}/activities`,
      headers: as(ana),
      payload: {
        label: 'Validar pago',
        type: 'action',
        bbox: { x: 0.12, y: 0.3, w: 0.15, h: 0.06 },
      },
    });
    await detect(versionId);
    const response = await app.inject({
      method: 'POST',
      url: `/diagram-versions/${versionId}/proposals/accept-high`,
      headers: as(ana),
    });
    expect(response.json()).toEqual({ accepted: 1 });
    expect((await pending(versionId)).byLabel['Validar pago']!.flags).toContain(
      'possible_duplicate',
    );
  });
});

describe('publicar', () => {
  it('con propuestas pendientes → 422 con el conteo; revisadas todas, publica', async () => {
    const { versionId } = await detected(NO_TRANSITIONS);
    const publish = () =>
      app.inject({
        method: 'POST',
        url: `/diagram-versions/${versionId}/publish`,
        headers: as(ana),
      });
    const { byLabel } = await pending(versionId);
    await accept(byLabel['Validar pago']!.id);
    const blocked = await publish();
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json()).toMatchObject({
      code: 'PENDING_PROPOSALS',
      message:
        'Revisa las 2 propuesta(s) de la detección (acéptalas o descártalas) antes de publicar.',
      pending: 2,
    });
    await accept(byLabel.start!.id);
    await discard(byLabel['Emitir factura']!.id);
    expect((await publish()).statusCode).toBe(200);
  });
});

describe('permisos y estado', () => {
  it('el Participante → 403; con el proyecto cerrado → 409', async () => {
    const { projectId, versionId } = await detected();
    const { byLabel } = await pending(versionId);
    expect((await accept(byLabel['Validar pago']!.id, {}, pablo)).statusCode).toBe(403);
    expect((await discard(byLabel['Validar pago']!.id, pablo)).statusCode).toBe(403);
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/status`,
      headers: as(ana),
      payload: { action: 'close' },
    });
    expect((await accept(byLabel['Validar pago']!.id)).statusCode).toBe(409);
  });

  it('una propuesta inexistente → 404', async () => {
    expect((await accept('66f3a1b2c3d4e5f601234567')).statusCode).toBe(404);
    expect((await accept('no-es-un-id')).statusCode).toBe(404);
  });
});

describe('volver a detectar', () => {
  it('no modifica las actividades ya aceptadas', async () => {
    const { versionId } = await detected(NO_TRANSITIONS);
    const { byLabel } = await pending(versionId);
    const accepted = (
      await accept(byLabel['Validar pago']!.id, { label: 'Validar el pago' })
    ).json();
    await detect(versionId);
    expect(await activitiesOf(versionId)).toEqual([accepted]);
    // La nueva propuesta coincide con la aceptada: posible duplicado.
    expect((await pending(versionId)).byLabel['Validar pago']!.flags).toContain(
      'possible_duplicate',
    );
  });
});
