import type { DetailStatus, DetailType, Priority } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commentsModel } from '../../src/modules/details/models/comment';
import { detailsModel } from '../../src/modules/details/models/detail';
import { votesModel } from '../../src/modules/details/models/vote';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US1 de la 007 (FR-001, FR-002, FR-003): indicadores calculados a mano sobre una semilla pequeña.
// Los días son los de la zona horaria del proyecto (America/Guayaquil, UTC-5; plan, ajuste 14).

let app: FastifyInstance;
let ana: TestUser;
let luis: TestUser;
let marta: TestUser;
let outsider: TestUser;
let projectId: string;
let diagramId: string;
let keys: Record<string, string>;

type Seed = {
  activity: string;
  type: DetailType;
  priority: Priority | null;
  role: string | null;
  status: DetailStatus;
  author: () => TestUser;
  at: string;
};

const SEED: Seed[] = [
  // d1 · d2 · d5 entran con los filtros por defecto (pendientes y validados).
  {
    activity: 'Validar pago',
    type: 'functional',
    priority: 'must',
    role: 'Cajero',
    status: 'pending',
    author: () => luis,
    at: '2026-09-10T15:00:00Z',
  },
  {
    activity: 'Validar pago',
    type: 'non_functional',
    priority: null,
    role: null,
    status: 'validated',
    author: () => marta,
    at: '2026-09-10T16:00:00Z',
  },
  {
    activity: 'Emitir factura',
    type: 'non_functional',
    priority: 'should',
    role: 'Cliente',
    status: 'discarded',
    author: () => luis,
    at: '2026-09-11T15:00:00Z',
  },
  {
    activity: 'Emitir factura',
    type: 'functional',
    priority: 'could',
    role: 'Cliente',
    status: 'duplicate',
    author: () => marta,
    at: '2026-09-11T15:00:00Z',
  },
  // 03:00 UTC del 12 es el 11 a las 22:00 en Guayaquil.
  {
    activity: 'Validar pago',
    type: 'business_rule',
    priority: 'must',
    role: 'Cajero',
    status: 'pending',
    author: () => ana,
    at: '2026-09-12T03:00:00Z',
  },
];

beforeAll(async () => {
  ({ app } = await buildTestApp('dashdescriptive', {
    withAuth: true,
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
  marta = await registerTestUser(app, 'Marta');
  outsider = await registerTestUser(app, 'Otra');
  projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
      [marta, 'participant'],
    ],
  });
  ({ diagramId, keys } = await publishedDiagram(app, authHeaders(ana), projectId));
  const ids: Types.ObjectId[] = [];
  for (const seed of SEED) {
    const detail = await detailsModel(app.mongo).create({
      projectId: new Types.ObjectId(projectId),
      diagramId: new Types.ObjectId(diagramId),
      activityKey: keys[seed.activity]!,
      given: 'el cliente tiene productos',
      when: 'paga con tarjeta',
      then: 'el sistema confirma el pago',
      type: seed.type,
      priority: seed.priority,
      authorRole: seed.role,
      status: seed.status,
      authorId: new Types.ObjectId(seed.author().id),
      createdAt: new Date(seed.at),
    });
    ids.push(detail._id);
  }
  const ref = (index: number) => ({
    detailId: ids[index]!,
    projectId: new Types.ObjectId(projectId),
  });
  await votesModel(app.mongo).create({
    ...ref(0),
    userId: new Types.ObjectId(marta.id),
    createdAt: new Date('2026-09-11T15:00:00Z'),
  });
  await votesModel(app.mongo).create({
    ...ref(1),
    userId: new Types.ObjectId(luis.id),
    createdAt: new Date('2026-09-12T15:00:00Z'),
  });
  // Un voto a un descartado: no cuenta con los filtros por defecto.
  await votesModel(app.mongo).create({
    ...ref(2),
    userId: new Types.ObjectId(ana.id),
    createdAt: new Date('2026-09-12T15:00:00Z'),
  });
  await commentsModel(app.mongo).create({
    ...ref(0),
    authorId: new Types.ObjectId(ana.id),
    text: 'ok',
    createdAt: new Date('2026-09-10T20:00:00Z'),
  });
});

afterAll(() => closeTestApp(app));

const get = (query = '', user = ana) =>
  app.inject({
    url: `/projects/${projectId}/dashboard/descriptive${query}`,
    headers: authHeaders(user),
  });

const counts = (items: Array<{ key: string; count: number }>) =>
  Object.fromEntries(items.map(({ key, count }) => [key, count]));

describe('indicadores con los filtros por defecto', () => {
  it('coinciden con el cálculo manual', async () => {
    const response = await get();
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.kpis).toEqual({
      totalDetails: 3,
      activeParticipants: 3,
      coveredActivitiesPct: 33.3,
      validatedPct: 33.3,
    });
    expect(body.byActivity).toEqual([
      { key: keys['Validar pago'], label: 'Validar pago', count: 3 },
      { key: keys['Emitir factura'], label: 'Emitir factura', count: 0 },
      { key: keys['Enviar pedido'], label: 'Enviar pedido', count: 0 },
    ]);
    expect(counts(body.byType)).toEqual({
      functional: 1,
      non_functional: 1,
      business_rule: 1,
      constraint: 0,
    });
    expect(body.byType[0]).toEqual({ key: 'functional', label: 'Funcional', count: 1 });
    expect(counts(body.byPriority)).toEqual({ must: 2, should: 0, could: 0, wont: 0, none: 1 });
    expect(body.byRole).toEqual([
      { key: 'Cajero', label: 'Cajero', count: 2 },
      { key: 'none', label: 'Sin rol', count: 1 },
    ]);
    expect(counts(body.byStatus)).toEqual({ pending: 2, validated: 1 });
    expect(body.timeline).toEqual([
      { date: '2026-09-10', created: 2, votes: 0, comments: 1 },
      { date: '2026-09-11', created: 1, votes: 1, comments: 0 },
      { date: '2026-09-12', created: 0, votes: 1, comments: 0 },
    ]);
  });
});

describe('filtros (FR-003)', () => {
  it('por tipo', async () => {
    const body = (await get('?type=non_functional')).json();
    expect(body.kpis.totalDetails).toBe(1);
    expect(counts(body.byStatus)).toEqual({ pending: 0, validated: 1 });
  });

  it('por estado: los descartados solo si se piden; los duplicados nunca', async () => {
    expect((await get('?status=discarded')).json().kpis.totalDetails).toBe(1);
    expect((await get('?status=duplicate')).json().kpis.totalDetails).toBe(0);
    expect(
      (await get('?status=pending&status=validated&status=discarded')).json().kpis.totalDetails,
    ).toBe(4);
  });

  it('por rango de fechas, con el día del proyecto', async () => {
    const body = (await get('?from=2026-09-11&to=2026-09-11')).json();
    expect(body.kpis).toMatchObject({ totalDetails: 1, activeParticipants: 1 });
    expect(body.timeline).toEqual([{ date: '2026-09-11', created: 1, votes: 0, comments: 0 }]);
  });

  it('por diagrama: solo sus actividades', async () => {
    const other = await publishedDiagram(app, authHeaders(ana), projectId, ['Otra actividad']);
    const body = (await get(`?diagramId=${other.diagramId}`)).json();
    expect(body.kpis).toMatchObject({ totalDetails: 0, coveredActivitiesPct: 0 });
    expect(body.byActivity).toEqual([
      { key: other.keys['Otra actividad'], label: 'Otra actividad', count: 0 },
    ]);
  });

  it('un filtro inválido → 400 con el mensaje en español', async () => {
    const response = await get('?from=2026-09-12&to=2026-09-10');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(Object.values(response.json().fields)).toContain(
      'La fecha inicial no puede ser posterior a la final.',
    );
    expect((await get('?type=raro')).statusCode).toBe(400);
  });
});

describe('acceso (FR-001)', () => {
  it('un Participante → 403 y quien no es miembro → 404', async () => {
    expect((await get('', luis)).statusCode).toBe(403);
    expect((await get('', outsider)).statusCode).toBe(404);
  });
});
