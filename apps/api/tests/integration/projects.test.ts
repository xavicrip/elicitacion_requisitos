import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogsModel } from '../../src/modules/audit/model';
import { projectsModel } from '../../src/modules/projects/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

let app: FastifyInstance;
let ana: TestUser;

beforeAll(async () => {
  ({ app } = await buildTestApp('projects', { withAuth: true }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
});

afterAll(() => closeTestApp(app));

const create = (user: TestUser, name: string, description?: string) =>
  app.inject({
    method: 'POST',
    url: '/projects',
    headers: authHeaders(user),
    payload: { name, description },
  });

const changeStatus = (user: TestUser, id: string, action: string) =>
  app.inject({
    method: 'POST',
    url: `/projects/${id}/status`,
    headers: authHeaders(user),
    payload: { action },
  });

describe('crear (US2 escenario 1)', () => {
  it('el proyecto nace en borrador con su creador como único Administrador', async () => {
    const response = await create(ana, 'Tienda en línea', 'Ventas por internet');
    expect(response.statusCode).toBe(201);
    const stored = await projectsModel(app.mongo).findById(response.json().id).lean();
    expect(stored).toMatchObject({
      name: 'Tienda en línea',
      description: 'Ventas por internet',
      status: 'draft',
      ownerId: new Types.ObjectId(ana.id),
      members: [{ userId: new Types.ObjectId(ana.id), role: 'admin' }],
    });
  });
});

describe('ciclo de estados (FR-006, US2 escenarios 2 y 3)', () => {
  it('borrador → abierto → cerrado → abierto, cada cambio auditado', async () => {
    const { id } = (await create(ana, 'Ciclo')).json();
    for (const [action, status] of [
      ['open', 'open'],
      ['close', 'closed'],
      ['reopen', 'open'],
    ] as const) {
      const response = await changeStatus(ana, id, action);
      expect(response.statusCode, action).toBe(200);
      expect(response.json().status).toBe(status);
    }
    const events = await auditLogsModel(app.mongo)
      .find({ projectId: new Types.ObjectId(id), action: 'project.status_changed' })
      .sort({ at: 1 })
      .lean();
    expect(events.map((e) => e.diff)).toEqual([
      { status: { from: 'draft', to: 'open' } },
      { status: { from: 'open', to: 'closed' } },
      { status: { from: 'closed', to: 'open' } },
    ]);
    expect(events[0]?.actorId).toEqual(new Types.ObjectId(ana.id));
  });

  it.each([
    ['close', 'draft'],
    ['reopen', 'draft'],
  ])('%s desde %s responde 409 sin cambiar nada', async (action) => {
    const { id } = (await create(ana, `Inválida ${action}`)).json();
    const response = await changeStatus(ana, id, action);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect((await projectsModel(app.mongo).findById(id).lean())?.status).toBe('draft');
  });
});

describe('editar', () => {
  it('actualiza nombre y descripción y la última actividad, con auditoría', async () => {
    const { id, lastActivityAt } = (await create(ana, 'Antes')).json();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${id}`,
      headers: authHeaders(ana),
      payload: { name: 'Después', description: 'Con descripción' },
    });
    expect(response.json()).toMatchObject({ name: 'Después', description: 'Con descripción' });
    expect(new Date(response.json().lastActivityAt).getTime()).toBeGreaterThan(
      new Date(lastActivityAt).getTime(),
    );
    const event = await auditLogsModel(app.mongo)
      .findOne({ projectId: new Types.ObjectId(id), action: 'project.updated' })
      .lean();
    expect(event?.diff).toEqual({
      name: { from: 'Antes', to: 'Después' },
      description: { from: '', to: 'Con descripción' },
    });
  });
});

describe('"Mis proyectos" (FR-012, FR-007)', () => {
  it('lista solo los proyectos del usuario, por última actividad, con su rol en cada uno', async () => {
    const luis = await registerTestUser(app, 'Luis');
    const own = (await create(luis, 'De Luis')).json();
    const shared = (await create(ana, 'Compartido con Luis')).json();
    // Luis es Participante en el proyecto de Ana (la US3 lo hará con una invitación).
    await projectsModel(app.mongo).updateOne(
      { _id: shared.id },
      {
        $push: {
          members: {
            userId: new Types.ObjectId(luis.id),
            role: 'participant',
            joinedAt: new Date(),
          },
        },
        $set: { lastActivityAt: new Date(Date.now() + 60_000) },
      },
    );

    const list = (await app.inject({ url: '/projects', headers: authHeaders(luis) })).json();
    expect(list.map((p: { id: string; myRole: string }) => [p.id, p.myRole])).toEqual([
      [shared.id, 'participant'],
      [own.id, 'admin'],
    ]);
  });

  it('un proyecto en borrado no aparece', async () => {
    const { id } = (await create(ana, 'Borrándose')).json();
    await projectsModel(app.mongo).updateOne({ _id: id }, { $set: { status: 'deleting' } });
    const list = (await app.inject({ url: '/projects', headers: authHeaders(ana) })).json();
    expect(list.map((p: { id: string }) => p.id)).not.toContain(id);
  });

  it('responde con p95 < 200 ms con 100 proyectos', async () => {
    const bea = await registerTestUser(app, 'Bea');
    const now = Date.now();
    await projectsModel(app.mongo).insertMany(
      Array.from({ length: 100 }, (_, i) => ({
        name: `Proyecto ${i}`,
        ownerId: new Types.ObjectId(bea.id),
        members: [{ userId: new Types.ObjectId(bea.id), role: 'admin', joinedAt: new Date() }],
        lastActivityAt: new Date(now - i * 1000),
      })),
    );
    const durations: number[] = [];
    for (let i = 0; i < 30; i++) {
      const started = performance.now();
      const response = await app.inject({ url: '/projects', headers: authHeaders(bea) });
      durations.push(performance.now() - started);
      expect(response.json()).toHaveLength(100);
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
    expect(p95).toBeLessThan(200);
  });
});
