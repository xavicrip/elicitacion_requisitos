import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

/**
 * Matriz de autorización (contracts/authorization-matrix.md), filas de proyectos. SC-003: el
 * 100 % de los accesos no autorizados se deniega. La US3 añade las filas de miembros e
 * invitaciones; la 003 y la 007, las de diagramas y dashboard.
 */

type Actor = 'anónimo' | 'no miembro' | 'participante' | 'administrador';
type Operation = {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** `null`: la operación no depende de un proyecto concreto. */
  path: (projectId: string) => string;
  body?: (projectName: string) => unknown;
  expected: Record<Actor, number>;
};

const OPERATIONS: Operation[] = [
  {
    name: 'GET /projects (mis proyectos)',
    method: 'GET',
    path: () => '/projects',
    expected: { anónimo: 401, 'no miembro': 200, participante: 200, administrador: 200 },
  },
  {
    name: 'POST /projects',
    method: 'POST',
    path: () => '/projects',
    body: () => ({ name: 'Nuevo' }),
    expected: { anónimo: 401, 'no miembro': 201, participante: 201, administrador: 201 },
  },
  {
    name: 'GET /projects/:id',
    method: 'GET',
    path: (id) => `/projects/${id}`,
    expected: { anónimo: 401, 'no miembro': 404, participante: 200, administrador: 200 },
  },
  {
    name: 'PATCH /projects/:id',
    method: 'PATCH',
    path: (id) => `/projects/${id}`,
    body: () => ({ name: 'Editado' }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 200 },
  },
  {
    name: 'DELETE /projects/:id',
    method: 'DELETE',
    path: (id) => `/projects/${id}`,
    body: (name) => ({ confirmName: name }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 202 },
  },
  {
    name: 'POST /projects/:id/status',
    method: 'POST',
    path: (id) => `/projects/${id}/status`,
    body: () => ({ action: 'open' }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 200 },
  },
];

const ACTORS: Actor[] = ['anónimo', 'no miembro', 'participante', 'administrador'];

let app: FastifyInstance;
let users: { admin: TestUser; participant: TestUser; outsider: TestUser };

beforeAll(async () => {
  ({ app } = await buildTestApp('matrix', { withAuth: true }));
  await app.ready();
  users = {
    admin: await registerTestUser(app, 'Admin'),
    participant: await registerTestUser(app, 'Participante'),
    outsider: await registerTestUser(app, 'Ajeno'),
  };
});

afterAll(() => closeTestApp(app));

const headersOf = (actor: Actor) =>
  ({
    anónimo: {},
    'no miembro': authHeaders(users.outsider),
    participante: authHeaders(users.participant),
    administrador: authHeaders(users.admin),
  })[actor];

/** Proyecto nuevo por caso: las operaciones que modifican no afectan a las demás. */
async function freshProject(status: 'draft' | 'deleting' = 'draft') {
  const name = `Matriz ${new Types.ObjectId().toHexString()}`;
  const id = await seedProject(app, {
    name,
    status,
    members: [
      [users.admin, 'admin'],
      [users.participant, 'participant'],
    ],
  });
  return { id, name };
}

const cases = OPERATIONS.flatMap((operation) =>
  ACTORS.map((actor) => [operation.name, actor, operation.expected[actor], operation] as const),
);

describe('matriz de autorización: proyectos (SC-003)', () => {
  it.each(cases)('%s — %s → %i', async (_name, actor, expected, operation) => {
    const { id, name } = await freshProject();
    const response = await app.inject({
      method: operation.method,
      url: operation.path(id),
      headers: headersOf(actor),
      payload: operation.body?.(name) as object | undefined,
    });
    expect(response.statusCode, response.body).toBe(expected);
  });

  const projectScoped = OPERATIONS.filter((operation) => operation.path('x').includes('x'));

  it.each(
    projectScoped.flatMap((operation) =>
      (['participante', 'administrador'] as const).map(
        (actor) => [operation.name, actor, operation] as const,
      ),
    ),
  )('un proyecto en deleting responde 404: %s — %s', async (_name, actor, operation) => {
    const { id, name } = await freshProject('deleting');
    const response = await app.inject({
      method: operation.method,
      url: operation.path(id),
      headers: headersOf(actor),
      payload: operation.body?.(name) as object | undefined,
    });
    expect(response.statusCode).toBe(404);
  });

  it('sin sesión responde 401 aunque el proyecto no exista (no revela nada)', async () => {
    const response = await app.inject({ url: `/projects/${new Types.ObjectId().toHexString()}` });
    expect(response.statusCode).toBe(401);
  });

  it('"Mis proyectos" nunca incluye proyectos de los que no se es miembro', async () => {
    const { id } = await freshProject();
    const response = await app.inject({ url: '/projects', headers: headersOf('no miembro') });
    const ids = (response.json() as Array<{ id: string; myRole: string }>).map((p) => p.id);
    expect(ids).not.toContain(id);
    // Lo que sí aparece son proyectos propios (creados en la fila POST de la matriz).
    for (const project of response.json() as Array<{ myRole: string }>) {
      expect(project.myRole).toBe('admin');
    }
  });

  it('un 404 de un proyecto ajeno es idéntico al de uno inexistente', async () => {
    const { id } = await freshProject();
    const foreign = await app.inject({ url: `/projects/${id}`, headers: headersOf('no miembro') });
    const missing = await app.inject({
      url: `/projects/${new Types.ObjectId().toHexString()}`,
      headers: headersOf('no miembro'),
    });
    expect(foreign.json()).toEqual(missing.json());
  });
});
