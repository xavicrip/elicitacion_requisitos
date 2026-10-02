import type { AnalysisInputFile } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { duplicateDecisionsModel } from '../../src/modules/dashboard/models/duplicate-decision';
import { detailsModel } from '../../src/modules/details/models/detail';
import { EXAMPLE_RESULTS, startFakeAnalysisWorker } from '../helpers/analysis-worker';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { createDetail, publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US3 de la 007 (FR-007, FR-009, FR-015): confirmar o rechazar un par de posibles duplicados y
// ajustar los términos del proyecto.

let app: FastifyInstance;
let ana: TestUser;
let luis: TestUser;
let worker: ReturnType<typeof startFakeAnalysisWorker>;
/** Resultados que el worker falso devuelve para un proyecto (por defecto, los del ejemplo). */
const handlerResults = new Map<string, unknown>();

beforeAll(async () => {
  let dbName: string;
  ({ app, dbName } = await buildTestApp('dupdecisions', {
    withAuth: true,
    featureFlags: 'dashboard=true',
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
  worker = startFakeAnalysisWorker(`test-${dbName}:bull`, async (input) => ({
    results: handlerResults.get(input.projectId) ?? EXAMPLE_RESULTS,
    summary: { detailCount: input.details.length },
  }));
});
afterAll(async () => {
  await worker.close();
  await closeTestApp(app);
});

async function projectWithPair() {
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
    ],
  });
  const diagram = await publishedDiagram(app, authHeaders(ana), projectId);
  const create = async (given: string) =>
    (
      await createDetail(app, authHeaders(luis), diagram.diagramId, diagram.keys['Validar pago']!, {
        given,
      })
    ).json().id as string;
  const a = await create('el cliente eligió pagar con tarjeta');
  const b = await create('el comprador eligió pagar con tarjeta');
  return { projectId, a, b };
}

const decide = (projectId: string, payload: object, user = ana) =>
  app.inject({
    method: 'POST',
    url: `/projects/${projectId}/duplicate-decisions`,
    headers: authHeaders(user),
    payload,
  });
const detail = (id: string) => detailsModel(app.mongo).findById(id).lean();

describe('confirmar un duplicado', () => {
  it('aplica la moderación de la 004 al otro detalle y registra la decisión', async () => {
    const { projectId, a, b } = await projectWithPair();
    const response = await decide(projectId, {
      pair: [b, a],
      decision: 'confirmed',
      keep: a,
      similarity: 0.93,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ pair: [a, b].sort(), decision: 'confirmed' });
    expect(await detail(b)).toMatchObject({
      status: 'duplicate',
      duplicateOf: new Types.ObjectId(a),
    });
    expect(await detail(a)).toMatchObject({ status: 'pending', duplicateOf: null });
    const stored = await duplicateDecisionsModel(app.mongo).findOne({ projectId }).lean();
    expect(stored).toMatchObject({ pair: [a, b].sort(), decision: 'confirmed', similarity: 0.93 });
  });

  it('exige indicar cuál se conserva, y que sea uno de los dos', async () => {
    const { projectId, a, b } = await projectWithPair();
    const missing = await decide(projectId, { pair: [a, b], decision: 'confirmed' });
    expect(missing.statusCode).toBe(400);
    expect(Object.values(missing.json().fields)).toContain(
      'Indica cuál de los dos detalles se conserva.',
    );
    const other = await decide(projectId, {
      pair: [a, b],
      decision: 'confirmed',
      keep: '66f3a1b2c3d4e5f601234567',
    });
    expect(other.statusCode).toBe(400);
    expect((await detail(b))?.status).toBe('pending');
  });

  it('con el proyecto cerrado → 409 y nada cambia', async () => {
    const { projectId, a, b } = await projectWithPair();
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/status`,
      headers: authHeaders(ana),
      payload: { action: 'close' },
    });
    const response = await decide(projectId, { pair: [a, b], decision: 'confirmed', keep: a });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe(
      'Solo se pueden marcar duplicados mientras el proyecto está abierto.',
    );
    expect((await detail(b))?.status).toBe('pending');
    expect(await duplicateDecisionsModel(app.mongo).countDocuments({ projectId })).toBe(0);
  });

  it('si la moderación no se puede aplicar, la decisión no queda registrada', async () => {
    const { projectId, a, b } = await projectWithPair();
    // `a` ya es duplicado de otro: no puede ser el original de `b`.
    await detailsModel(app.mongo).updateOne({ _id: a }, { $set: { status: 'duplicate' } });
    const response = await decide(projectId, { pair: [a, b], decision: 'confirmed', keep: a });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(await duplicateDecisionsModel(app.mongo).countDocuments({ projectId })).toBe(0);
  });
});

describe('rechazar un par', () => {
  it('lo registra sin tocar los detalles, y el siguiente análisis lo recibe', async () => {
    const { projectId, a, b } = await projectWithPair();
    const response = await decide(projectId, { pair: [a, b], decision: 'rejected' });
    expect(response.statusCode).toBe(201);
    expect((await detail(a))?.status).toBe('pending');
    expect((await detail(b))?.status).toBe('pending');

    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/analysis-runs`,
      headers: authHeaders(ana),
    });
    let input: AnalysisInputFile | undefined;
    await vi.waitFor(
      () => {
        input = worker.received.find((job) => job.data.projectId === projectId)?.input;
        expect(input).toBeDefined();
      },
      { timeout: 5000, interval: 50 },
    );
    expect(input!.duplicateDecisions).toEqual([{ pair: [a, b].sort(), decision: 'rejected' }]);
  });

  it('un par decidido deja de aparecer en el último análisis, sin relanzarlo', async () => {
    const { projectId, a, b } = await projectWithPair();
    const pair = [a, b].sort() as [string, string];
    handlerResults.set(projectId, {
      ...EXAMPLE_RESULTS,
      duplicates: [
        { pair, similarity: 0.93 },
        { pair: ['x', 'y'], similarity: 0.9 },
      ],
    });
    const run = (
      await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/analysis-runs`,
        headers: authHeaders(ana),
      })
    ).json();
    const latest = async () =>
      (
        await app.inject({
          url: `/projects/${projectId}/analysis-runs/latest`,
          headers: authHeaders(ana),
        })
      ).json();
    await vi.waitFor(async () => expect((await latest()).id).toBe(run.id), {
      timeout: 5000,
      interval: 50,
    });
    expect((await latest()).results.duplicates).toHaveLength(2);
    await decide(projectId, { pair: [b, a], decision: 'rejected' });
    expect((await latest()).results.duplicates).toEqual([{ pair: ['x', 'y'], similarity: 0.9 }]);
  });

  it('decidir dos veces el mismo par (en cualquier orden) → 409', async () => {
    const { projectId, a, b } = await projectWithPair();
    expect((await decide(projectId, { pair: [a, b], decision: 'rejected' })).statusCode).toBe(201);
    const again = await decide(projectId, { pair: [b, a], decision: 'confirmed', keep: a });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      code: 'ALREADY_DECIDED',
      message: 'Este par ya se revisó.',
    });
    expect((await detail(b))?.status).toBe('pending');
  });
});

describe('validación y acceso', () => {
  it('detalles de otro proyecto o inexistentes → 422; par repetido → 400', async () => {
    const { projectId, a } = await projectWithPair();
    const other = await projectWithPair();
    const foreign = await decide(projectId, { pair: [a, other.a], decision: 'rejected' });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json().message).toBe(
      'Alguno de los dos detalles ya no existe en este proyecto.',
    );
    expect((await decide(projectId, { pair: [a, 'x'], decision: 'rejected' })).statusCode).toBe(
      422,
    );
    expect((await decide(projectId, { pair: [a, a], decision: 'rejected' })).statusCode).toBe(400);
  });

  it('Participante → 403', async () => {
    const { projectId, a, b } = await projectWithPair();
    expect((await decide(projectId, { pair: [a, b], decision: 'rejected' }, luis)).statusCode).toBe(
      403,
    );
    const settings = await app.inject({
      url: `/projects/${projectId}/analysis-settings`,
      headers: authHeaders(luis),
    });
    expect(settings.statusCode).toBe(403);
  });
});

describe('ajustes del análisis', () => {
  const url = (projectId: string) => `/projects/${projectId}/analysis-settings`;
  const put = (projectId: string, payload: object) =>
    app.inject({ method: 'PUT', url: url(projectId), headers: authHeaders(ana), payload });
  const defaults = {
    extraAmbiguousTerms: [],
    extraStopwords: [],
    schedule: { enabled: true, cron: '0 3 * * *', timezone: 'America/Guayaquil' },
  };

  it('por defecto, sin términos propios y con la programación nocturna', async () => {
    const { projectId } = await projectWithPair();
    const response = await app.inject({ url: url(projectId), headers: authHeaders(ana) });
    expect(response.json()).toEqual(defaults);
  });

  it('guarda los términos (en minúsculas y sin repetir) y llegan al siguiente análisis', async () => {
    const { projectId } = await projectWithPair();
    const saved = await put(projectId, {
      ...defaults,
      extraAmbiguousTerms: ['Bonito', 'bonito', ' ágil '],
      extraStopwords: ['tienda'],
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().extraAmbiguousTerms).toEqual(['bonito', 'ágil']);
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/analysis-runs`,
      headers: authHeaders(ana),
    });
    await vi.waitFor(
      () => {
        const job = worker.received.find((item) => item.data.projectId === projectId);
        expect(job?.data.settings).toMatchObject({
          extraAmbiguousTerms: ['bonito', 'ágil'],
          extraStopwords: ['tienda'],
        });
      },
      { timeout: 5000, interval: 50 },
    );
  });

  it('valida los límites, el cron y la zona horaria', async () => {
    const { projectId } = await projectWithPair();
    const many = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    const tooMany = await put(projectId, { ...defaults, extraAmbiguousTerms: many(101) });
    expect(tooMany.statusCode).toBe(400);
    expect(Object.values(tooMany.json().fields)).toContain('Como máximo 100 términos ambiguos.');
    expect((await put(projectId, { ...defaults, extraStopwords: many(201) })).statusCode).toBe(400);
    expect(
      (
        await put(projectId, {
          ...defaults,
          schedule: { ...defaults.schedule, cron: 'cada noche' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await put(projectId, {
          ...defaults,
          schedule: { ...defaults.schedule, timezone: 'Marte/Olimpo' },
        })
      ).statusCode,
    ).toBe(400);
  });
});
