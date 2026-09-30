import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invitationsModel } from '../../src/modules/invitations/model';
import { newRefreshToken } from '../../src/modules/auth/tokens';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

/**
 * Matriz de autorización (contracts/authorization-matrix.md). SC-003: el 100 % de los accesos
 * no autorizados se deniega. Filas de proyectos (US4), de miembros e invitaciones (US3); la
 * 003 y la 007 añaden las de diagramas y dashboard.
 */

type Actor = 'anónimo' | 'no miembro' | 'participante' | 'administrador';

/** Datos de cada caso: un proyecto nuevo con Admin, Participante y otro Participante. */
type Context = {
  projectId: string;
  name: string;
  /** Id del propio actor (para "abandonar el proyecto"). */
  selfId: string;
  otherId: string;
  invitationId: string;
  token: string;
};

type Operation = {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: (ctx: Context) => string;
  body?: (ctx: Context) => unknown;
  /** La operación depende de un proyecto (se comprueba también en `deleting`). */
  projectScoped?: boolean;
  expected: Record<Actor, number>;
};

const OPERATIONS: Operation[] = [
  // --- Proyectos (US4)
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
    path: (c) => `/projects/${c.projectId}`,
    projectScoped: true,
    expected: { anónimo: 401, 'no miembro': 404, participante: 200, administrador: 200 },
  },
  {
    name: 'PATCH /projects/:id',
    method: 'PATCH',
    path: (c) => `/projects/${c.projectId}`,
    body: () => ({ name: 'Editado' }),
    projectScoped: true,
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 200 },
  },
  {
    name: 'DELETE /projects/:id',
    method: 'DELETE',
    path: (c) => `/projects/${c.projectId}`,
    body: (c) => ({ confirmName: c.name }),
    projectScoped: true,
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 202 },
  },
  {
    name: 'POST /projects/:id/status',
    method: 'POST',
    path: (c) => `/projects/${c.projectId}/status`,
    body: () => ({ action: 'open' }),
    projectScoped: true,
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 200 },
  },
  // --- Miembros (US3)
  {
    name: 'GET /projects/:id/members',
    method: 'GET',
    path: (c) => `/projects/${c.projectId}/members`,
    projectScoped: true,
    expected: { anónimo: 401, 'no miembro': 404, participante: 200, administrador: 200 },
  },
  {
    name: 'PATCH /projects/:id/members/:uid',
    method: 'PATCH',
    path: (c) => `/projects/${c.projectId}/members/${c.otherId}`,
    body: () => ({ role: 'admin' }),
    projectScoped: true,
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 200 },
  },
  {
    name: 'DELETE /projects/:id/members/:uid (otro)',
    method: 'DELETE',
    path: (c) => `/projects/${c.projectId}/members/${c.otherId}`,
    projectScoped: true,
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 204 },
  },
  {
    // El Administrador es el único: abandonar dejaría el proyecto sin ninguno.
    name: 'DELETE /projects/:id/members/:uid (uno mismo)',
    method: 'DELETE',
    path: (c) => `/projects/${c.projectId}/members/${c.selfId}`,
    projectScoped: true,
    expected: { anónimo: 401, 'no miembro': 404, participante: 204, administrador: 409 },
  },
  // --- Invitaciones (US3)
  {
    name: 'GET /projects/:id/invitations',
    method: 'GET',
    path: (c) => `/projects/${c.projectId}/invitations`,
    projectScoped: true,
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 200 },
  },
  {
    name: 'POST /projects/:id/invitations',
    method: 'POST',
    path: (c) => `/projects/${c.projectId}/invitations`,
    projectScoped: true,
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 201 },
  },
  {
    name: 'DELETE /projects/:id/invitations/:iid',
    method: 'DELETE',
    path: (c) => `/projects/${c.projectId}/invitations/${c.invitationId}`,
    projectScoped: true,
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 204 },
  },
  {
    name: 'GET /invitations/:token',
    method: 'GET',
    path: (c) => `/invitations/${c.token}`,
    expected: { anónimo: 200, 'no miembro': 200, participante: 200, administrador: 200 },
  },
  {
    name: 'POST /invitations/:token/accept',
    method: 'POST',
    path: (c) => `/invitations/${c.token}/accept`,
    expected: { anónimo: 401, 'no miembro': 200, participante: 200, administrador: 200 },
  },
];

const ACTORS: Actor[] = ['anónimo', 'no miembro', 'participante', 'administrador'];

let app: FastifyInstance;
let users: { admin: TestUser; participant: TestUser; other: TestUser; outsider: TestUser };

beforeAll(async () => {
  ({ app } = await buildTestApp('matrix', { withAuth: true }));
  await app.ready();
  users = {
    admin: await registerTestUser(app, 'Admin'),
    participant: await registerTestUser(app, 'Participante'),
    other: await registerTestUser(app, 'Otro'),
    outsider: await registerTestUser(app, 'Ajeno'),
  };
});

afterAll(() => closeTestApp(app));

const userOf = (actor: Actor) =>
  ({
    anónimo: undefined,
    'no miembro': users.outsider,
    participante: users.participant,
    administrador: users.admin,
  })[actor];

const headersOf = (actor: Actor) => {
  const user = userOf(actor);
  return user ? authHeaders(user) : {};
};

/** Proyecto nuevo por caso: las operaciones que modifican no afectan a las demás. */
async function freshContext(actor: Actor, status: 'draft' | 'deleting' = 'draft') {
  const name = `Matriz ${new Types.ObjectId().toHexString()}`;
  const projectId = await seedProject(app, {
    name,
    status,
    members: [
      [users.admin, 'admin'],
      [users.participant, 'participant'],
      [users.other, 'participant'],
    ],
  });
  const { token, hash } = newRefreshToken();
  const invitation = await invitationsModel(app.mongo).create({
    projectId: new Types.ObjectId(projectId),
    tokenHash: hash,
    createdBy: new Types.ObjectId(users.admin.id),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return {
    projectId,
    name,
    selfId: (userOf(actor) ?? users.participant).id,
    otherId: users.other.id,
    invitationId: invitation._id.toHexString(),
    token,
  } satisfies Context;
}

async function run(operation: Operation, actor: Actor, ctx: Context) {
  return app.inject({
    method: operation.method,
    url: operation.path(ctx),
    headers: headersOf(actor),
    payload: operation.body?.(ctx) as object | undefined,
  });
}

const cases = OPERATIONS.flatMap((operation) =>
  ACTORS.map((actor) => [operation.name, actor, operation.expected[actor], operation] as const),
);

describe('matriz de autorización (SC-003)', () => {
  it.each(cases)('%s — %s → %i', async (_name, actor, expected, operation) => {
    const response = await run(operation, actor, await freshContext(actor));
    expect(response.statusCode, response.body).toBe(expected);
  });

  it.each(
    OPERATIONS.filter((operation) => operation.projectScoped).flatMap((operation) =>
      (['participante', 'administrador'] as const).map(
        (actor) => [operation.name, actor, operation] as const,
      ),
    ),
  )('un proyecto en deleting responde 404: %s — %s', async (_name, actor, operation) => {
    const response = await run(operation, actor, await freshContext(actor, 'deleting'));
    expect(response.statusCode).toBe(404);
  });

  it('sin sesión responde 401 aunque el proyecto no exista (no revela nada)', async () => {
    const response = await app.inject({ url: `/projects/${new Types.ObjectId().toHexString()}` });
    expect(response.statusCode).toBe(401);
  });

  it('"Mis proyectos" nunca incluye proyectos de los que no se es miembro', async () => {
    const { projectId } = await freshContext('no miembro');
    const response = await app.inject({ url: '/projects', headers: headersOf('no miembro') });
    const list = response.json() as Array<{ id: string; myRole: string }>;
    expect(list.map((p) => p.id)).not.toContain(projectId);
  });

  it('un 404 de un proyecto ajeno es idéntico al de uno inexistente', async () => {
    const { projectId } = await freshContext('no miembro');
    const foreign = await app.inject({
      url: `/projects/${projectId}`,
      headers: headersOf('no miembro'),
    });
    const missing = await app.inject({
      url: `/projects/${new Types.ObjectId().toHexString()}`,
      headers: headersOf('no miembro'),
    });
    expect(foreign.json()).toEqual(missing.json());
  });

  it('PATCH de rol: degradar al único Administrador responde 409', async () => {
    const ctx = await freshContext('administrador');
    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${ctx.projectId}/members/${users.admin.id}`,
      headers: headersOf('administrador'),
      payload: { role: 'participant' },
    });
    expect(response.statusCode).toBe(409);
  });
});
