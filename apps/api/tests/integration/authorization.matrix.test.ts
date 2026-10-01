import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invitationsModel } from '../../src/modules/invitations/model';
import { newRefreshToken } from '../../src/modules/auth/tokens';
import { projectsModel } from '../../src/modules/projects/model';
import { activitiesModel } from '../../src/modules/diagrams/models/activity';
import { commentsModel } from '../../src/modules/details/models/comment';
import { detailsModel } from '../../src/modules/details/models/detail';
import { diagramsModel } from '../../src/modules/diagrams/models/diagram';
import { versionsModel, type VersionImage } from '../../src/modules/diagrams/models/version';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { DIAGRAM_FLAGS, multipart, fixture, uploadDiagram } from '../helpers/diagrams';
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
  ({ app } = await buildTestApp('matrix', {
    withAuth: true,
    featureFlags: DIAGRAM_FLAGS,
  }));
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

// --- Diagramas, versiones, imágenes y actividades (feature 003, T046)

/** Proyecto con un diagrama publicado (v1) con borrador (v2) y otro solo publicado. */
type DiagramContext = {
  projectId: string;
  diagramId: string;
  /** Diagrama sin borrador: admite subir una versión nueva. */
  publishedOnlyDiagramId: string;
  publishedVersionId: string;
  draftVersionId: string;
  publishedActivityId: string;
  draftActivityId: string;
};

type DiagramOperation = {
  name: string;
  request: (ctx: DiagramContext) => {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  };
  expected: Record<Actor, number>;
  /** Respuesta del Administrador con el proyecto cerrado (solo lectura). */
  closedAdmin: number;
};

const bbox = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
const upload = (fields: Record<string, string>) => {
  const body = multipart(fields, { buffer: fixture('compra-simple.png'), filename: 'd.png' });
  return { headers: body.headers, payload: body.payload };
};

const DIAGRAM_OPERATIONS: DiagramOperation[] = [
  {
    name: 'GET /projects/:id/diagrams',
    request: (c) => ({ method: 'GET', url: `/projects/${c.projectId}/diagrams` }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 200, administrador: 200 },
    closedAdmin: 200,
  },
  {
    name: 'POST /projects/:id/diagrams',
    request: (c) => ({
      method: 'POST',
      url: `/projects/${c.projectId}/diagrams`,
      ...upload({ name: 'Nuevo' }),
    }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 201 },
    closedAdmin: 409,
  },
  {
    name: 'POST /diagrams/:id/versions',
    request: (c) => ({
      method: 'POST',
      url: `/diagrams/${c.publishedOnlyDiagramId}/versions`,
      ...upload({}),
    }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 201 },
    closedAdmin: 409,
  },
  {
    name: 'GET /diagram-versions/:id (publicada)',
    request: (c) => ({ method: 'GET', url: `/diagram-versions/${c.publishedVersionId}` }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 200, administrador: 200 },
    closedAdmin: 200,
  },
  {
    name: 'GET /diagram-versions/:id (borrador)',
    request: (c) => ({ method: 'GET', url: `/diagram-versions/${c.draftVersionId}` }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 404, administrador: 200 },
    closedAdmin: 200,
  },
  {
    name: 'GET /diagram-versions/:id/image/display (publicada)',
    request: (c) => ({
      method: 'GET',
      url: `/diagram-versions/${c.publishedVersionId}/image/display`,
    }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 200, administrador: 200 },
    closedAdmin: 200,
  },
  {
    name: 'GET /diagram-versions/:id/image/thumb (borrador)',
    request: (c) => ({ method: 'GET', url: `/diagram-versions/${c.draftVersionId}/image/thumb` }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 404, administrador: 200 },
    closedAdmin: 200,
  },
  {
    name: 'POST /diagram-versions/:id/publish',
    request: (c) => ({ method: 'POST', url: `/diagram-versions/${c.draftVersionId}/publish` }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 200 },
    closedAdmin: 409,
  },
  {
    name: 'POST /diagram-versions/:id/activities',
    request: (c) => ({
      method: 'POST',
      url: `/diagram-versions/${c.draftVersionId}/activities`,
      payload: { label: 'Nueva', type: 'action', bbox },
    }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 201 },
    closedAdmin: 409,
  },
  {
    name: 'PATCH /activities/:id (borrador)',
    request: (c) => ({
      method: 'PATCH',
      url: `/activities/${c.draftActivityId}`,
      headers: { 'if-match': '"0"' },
      payload: { label: 'Editada' },
    }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 200 },
    closedAdmin: 409,
  },
  {
    name: 'PATCH /activities/:id (publicada: no editable)',
    request: (c) => ({
      method: 'PATCH',
      url: `/activities/${c.publishedActivityId}`,
      headers: { 'if-match': '"0"' },
      payload: { label: 'Editada' },
    }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 409 },
    closedAdmin: 409,
  },
  {
    name: 'DELETE /activities/:id (borrador)',
    request: (c) => ({ method: 'DELETE', url: `/activities/${c.draftActivityId}` }),
    expected: { anónimo: 401, 'no miembro': 404, participante: 403, administrador: 204 },
    closedAdmin: 409,
  },
];

let baseImage: VersionImage;

/** Imagen de una subida real, compartida por las versiones sembradas de la matriz. */
async function sharedImage(): Promise<VersionImage> {
  if (baseImage) return baseImage;
  const projectId = await seedProject(app, { members: [[users.admin, 'admin']] });
  const { id } = (await uploadDiagram(app, authHeaders(users.admin), projectId)).json();
  baseImage = (await versionsModel(app.mongo).findById(id).lean())!.image;
  return baseImage;
}

async function diagramContext(status: 'open' | 'closed' | 'deleting'): Promise<DiagramContext> {
  const image = await sharedImage();
  const projectId = await seedProject(app, {
    status,
    members: [
      [users.admin, 'admin'],
      [users.participant, 'participant'],
    ],
  });
  const project = new Types.ObjectId(projectId);
  const createdBy = new Types.ObjectId(users.admin.id);
  const [diagram, publishedOnly] = await diagramsModel(app.mongo).create([
    { projectId: project, name: 'Compra', order: 0 },
    { projectId: project, name: 'Devoluciones', order: 1 },
  ]);
  const [published, draft, onlyPublished] = await versionsModel(app.mongo).create([
    {
      diagramId: diagram!._id,
      projectId: project,
      number: 1,
      status: 'published',
      publishedAt: new Date(),
      image,
      createdBy,
    },
    { diagramId: diagram!._id, projectId: project, number: 2, status: 'draft', image, createdBy },
    {
      diagramId: publishedOnly!._id,
      projectId: project,
      number: 1,
      status: 'published',
      publishedAt: new Date(),
      image,
      createdBy,
    },
  ]);
  await diagramsModel(app.mongo).bulkWrite([
    {
      updateOne: { filter: { _id: diagram!._id }, update: { publishedVersionId: published!._id } },
    },
    {
      updateOne: {
        filter: { _id: publishedOnly!._id },
        update: { publishedVersionId: onlyPublished!._id },
      },
    },
  ]);
  const activity = (versionId: Types.ObjectId) => ({
    versionId,
    diagramId: diagram!._id,
    projectId: project,
    label: 'Validar pago',
    type: 'action' as const,
    bbox,
  });
  const [publishedActivity, draftActivity] = await activitiesModel(app.mongo).create([
    activity(published!._id),
    activity(draft!._id),
  ]);
  return {
    projectId,
    diagramId: diagram!._id.toHexString(),
    publishedOnlyDiagramId: publishedOnly!._id.toHexString(),
    publishedVersionId: published!._id.toHexString(),
    draftVersionId: draft!._id.toHexString(),
    publishedActivityId: publishedActivity!._id.toHexString(),
    draftActivityId: draftActivity!._id.toHexString(),
  };
}

async function runDiagram(operation: DiagramOperation, actor: Actor, ctx: DiagramContext) {
  const { headers, ...request } = operation.request(ctx);
  return app.inject({
    ...request,
    headers: { ...headersOf(actor), ...headers },
    payload: request.payload as string | object | undefined,
  });
}

describe('matriz de autorización: diagramas (003)', () => {
  it.each(
    DIAGRAM_OPERATIONS.flatMap((operation) =>
      ACTORS.map((actor) => [operation.name, actor, operation.expected[actor], operation] as const),
    ),
  )('%s — %s → %i', async (_name, actor, expected, operation) => {
    const response = await runDiagram(operation, actor, await diagramContext('open'));
    expect(response.statusCode, response.body).toBe(expected);
  });

  it.each(
    DIAGRAM_OPERATIONS.map(
      (operation) => [operation.name, operation.closedAdmin, operation] as const,
    ),
  )(
    'proyecto cerrado (solo lectura): %s — administrador → %i',
    async (_name, expected, operation) => {
      const response = await runDiagram(operation, 'administrador', await diagramContext('closed'));
      expect(response.statusCode, response.body).toBe(expected);
    },
  );

  it.each(DIAGRAM_OPERATIONS.map((operation) => [operation.name, operation] as const))(
    'un proyecto en deleting responde 404: %s — administrador',
    async (_name, operation) => {
      const response = await runDiagram(
        operation,
        'administrador',
        await diagramContext('deleting'),
      );
      expect(response.statusCode).toBe(404);
    },
  );

  it('un 404 de una versión ajena es idéntico al de una inexistente', async () => {
    const ctx = await diagramContext('open');
    const foreign = await app.inject({
      url: `/diagram-versions/${ctx.publishedVersionId}`,
      headers: headersOf('no miembro'),
    });
    const missing = await app.inject({
      url: `/diagram-versions/${new Types.ObjectId().toHexString()}`,
      headers: headersOf('no miembro'),
    });
    expect(foreign.json()).toEqual(missing.json());
  });
});

// --- Detalles, votos, comentarios, cobertura, facets y huérfanos (feature 004, T047)

/** El autor del detalle es un Participante; "participante" es otro Participante. */
type DetailActor = Actor | 'autor';
const DETAIL_ACTORS: DetailActor[] = [...ACTORS, 'autor'];

type DetailContext = DiagramContext & {
  /** Detalle pendiente del autor en la actividad publicada. */
  detailId: string;
  /** Detalle validado del autor. */
  validatedId: string;
  /** Detalle huérfano (su key no está en la versión publicada). */
  orphanId: string;
  /** Comentario de "participante" sobre `detailId`. */
  commentId: string;
  activityKey: string;
  otherKey: string;
};

type DetailOperation = {
  name: string;
  request: (ctx: DetailContext) => {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  };
  expected: Record<DetailActor, number>;
  /** Respuesta del Administrador con el proyecto cerrado (solo lectura, FR-013). */
  closedAdmin: number;
};

const scenarioPayload = {
  given: 'el cliente tiene productos',
  when: 'paga con tarjeta',
  then: 'confirma el pago',
  type: 'functional',
};
const members = { 'no miembro': 404, anónimo: 401 } as const;

const DETAIL_OPERATIONS: DetailOperation[] = [
  {
    name: 'GET /diagrams/:id/activities/:key/details',
    request: (c) => ({
      method: 'GET',
      url: `/diagrams/${c.diagramId}/activities/${c.activityKey}/details`,
    }),
    expected: { ...members, participante: 200, administrador: 200, autor: 200 },
    closedAdmin: 200,
  },
  {
    name: 'POST /diagrams/:id/activities/:key/details',
    request: (c) => ({
      method: 'POST',
      url: `/diagrams/${c.diagramId}/activities/${c.activityKey}/details`,
      payload: scenarioPayload,
    }),
    expected: { ...members, participante: 201, administrador: 201, autor: 201 },
    closedAdmin: 409,
  },
  {
    name: 'PATCH /details/:id (pendiente)',
    request: (c) => ({
      method: 'PATCH',
      url: `/details/${c.detailId}`,
      headers: { 'if-match': '"0"' },
      payload: { then: 'otra cosa distinta' },
    }),
    expected: { ...members, participante: 403, administrador: 200, autor: 200 },
    closedAdmin: 409,
  },
  {
    name: 'PATCH /details/:id (validado)',
    request: (c) => ({
      method: 'PATCH',
      url: `/details/${c.validatedId}`,
      headers: { 'if-match': '"0"' },
      payload: { then: 'otra cosa distinta' },
    }),
    expected: { ...members, participante: 403, administrador: 200, autor: 403 },
    closedAdmin: 409,
  },
  {
    name: 'DELETE /details/:id',
    request: (c) => ({ method: 'DELETE', url: `/details/${c.detailId}` }),
    expected: { ...members, participante: 403, administrador: 204, autor: 204 },
    closedAdmin: 409,
  },
  {
    name: 'GET /details/:id/history',
    request: (c) => ({ method: 'GET', url: `/details/${c.detailId}/history` }),
    expected: { ...members, participante: 200, administrador: 200, autor: 200 },
    closedAdmin: 200,
  },
  {
    name: 'POST /details/:id/status',
    request: (c) => ({
      method: 'POST',
      url: `/details/${c.detailId}/status`,
      payload: { status: 'validated' },
    }),
    expected: { ...members, participante: 403, administrador: 200, autor: 403 },
    closedAdmin: 409,
  },
  {
    name: 'POST /details/:id/reassign (huérfano)',
    request: (c) => ({
      method: 'POST',
      url: `/details/${c.orphanId}/reassign`,
      payload: { diagramId: c.diagramId, activityKey: c.otherKey },
    }),
    expected: { ...members, participante: 403, administrador: 200, autor: 403 },
    closedAdmin: 409,
  },
  {
    name: 'GET /projects/:id/details/orphans',
    request: (c) => ({ method: 'GET', url: `/projects/${c.projectId}/details/orphans` }),
    expected: { ...members, participante: 403, administrador: 200, autor: 403 },
    closedAdmin: 200,
  },
  {
    name: 'GET /projects/:id/details/facets',
    request: (c) => ({ method: 'GET', url: `/projects/${c.projectId}/details/facets` }),
    expected: { ...members, participante: 200, administrador: 200, autor: 200 },
    closedAdmin: 200,
  },
  {
    name: 'GET /diagram-versions/:id/coverage (publicada)',
    request: (c) => ({ method: 'GET', url: `/diagram-versions/${c.publishedVersionId}/coverage` }),
    expected: { ...members, participante: 200, administrador: 200, autor: 200 },
    closedAdmin: 200,
  },
  {
    name: 'GET /diagram-versions/:id/coverage (borrador)',
    request: (c) => ({ method: 'GET', url: `/diagram-versions/${c.draftVersionId}/coverage` }),
    expected: { ...members, participante: 404, administrador: 200, autor: 404 },
    closedAdmin: 200,
  },
  {
    name: 'PUT /details/:id/vote',
    request: (c) => ({ method: 'PUT', url: `/details/${c.detailId}/vote` }),
    expected: { ...members, participante: 200, administrador: 200, autor: 403 },
    closedAdmin: 409,
  },
  {
    name: 'DELETE /details/:id/vote',
    request: (c) => ({ method: 'DELETE', url: `/details/${c.detailId}/vote` }),
    expected: { ...members, participante: 200, administrador: 200, autor: 200 },
    closedAdmin: 409,
  },
  {
    name: 'GET /details/:id/comments',
    request: (c) => ({ method: 'GET', url: `/details/${c.detailId}/comments` }),
    expected: { ...members, participante: 200, administrador: 200, autor: 200 },
    closedAdmin: 200,
  },
  {
    name: 'POST /details/:id/comments',
    request: (c) => ({
      method: 'POST',
      url: `/details/${c.detailId}/comments`,
      payload: { text: 'un comentario' },
    }),
    expected: { ...members, participante: 201, administrador: 201, autor: 201 },
    closedAdmin: 409,
  },
  {
    name: 'PATCH /comments/:id (de "participante")',
    request: (c) => ({
      method: 'PATCH',
      url: `/comments/${c.commentId}`,
      payload: { text: 'editado' },
    }),
    expected: { ...members, participante: 200, administrador: 403, autor: 403 },
    closedAdmin: 409,
  },
  {
    name: 'DELETE /comments/:id (de "participante")',
    request: (c) => ({ method: 'DELETE', url: `/comments/${c.commentId}` }),
    expected: { ...members, participante: 204, administrador: 204, autor: 403 },
    closedAdmin: 409,
  },
];

/** "participante" es `users.other`; el autor de los detalles, `users.participant`. */
const detailUserOf = (actor: DetailActor) =>
  actor === 'autor' ? users.participant : actor === 'participante' ? users.other : userOf(actor);

async function detailContext(status: 'open' | 'closed' | 'deleting'): Promise<DetailContext> {
  const ctx = await diagramContext(status);
  const project = new Types.ObjectId(ctx.projectId);
  // `diagramContext` crea los miembros admin y participante; se añade `other`.
  await projectsModel(app.mongo).updateOne(
    { _id: project },
    {
      $push: {
        members: {
          userId: new Types.ObjectId(users.other.id),
          role: 'participant',
          joinedAt: new Date(),
        },
      },
    },
  );
  const published = await activitiesModel(app.mongo)
    .findOne({ versionId: new Types.ObjectId(ctx.publishedVersionId) })
    .lean();
  const other = await activitiesModel(app.mongo).create({
    versionId: new Types.ObjectId(ctx.publishedVersionId),
    diagramId: new Types.ObjectId(ctx.diagramId),
    projectId: project,
    label: 'Emitir factura',
    type: 'action',
    bbox: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 },
  });
  const base = {
    projectId: project,
    diagramId: new Types.ObjectId(ctx.diagramId),
    authorId: new Types.ObjectId(users.participant.id),
    ...scenarioPayload,
    type: 'functional' as const,
  };
  const [detail, validated, orphan] = await detailsModel(app.mongo).create([
    { ...base, activityKey: published!.key },
    { ...base, activityKey: published!.key, status: 'validated' },
    { ...base, activityKey: crypto.randomUUID() },
  ]);
  const comment = await commentsModel(app.mongo).create({
    detailId: detail!._id,
    projectId: project,
    authorId: new Types.ObjectId(users.other.id),
    text: 'un comentario',
  });
  return {
    ...ctx,
    detailId: detail!._id.toHexString(),
    validatedId: validated!._id.toHexString(),
    orphanId: orphan!._id.toHexString(),
    commentId: comment._id.toHexString(),
    activityKey: published!.key,
    otherKey: other.key,
  };
}

async function runDetail(operation: DetailOperation, actor: DetailActor, ctx: DetailContext) {
  const { headers, ...request } = operation.request(ctx);
  const user = detailUserOf(actor);
  return app.inject({
    ...request,
    headers: { ...(user ? authHeaders(user) : {}), ...headers },
    payload: request.payload as object | undefined,
  });
}

describe('matriz de autorización: detalles (004)', () => {
  it.each(
    DETAIL_OPERATIONS.flatMap((operation) =>
      DETAIL_ACTORS.map(
        (actor) => [operation.name, actor, operation.expected[actor], operation] as const,
      ),
    ),
  )('%s — %s → %i', async (_name, actor, expected, operation) => {
    const response = await runDetail(operation, actor, await detailContext('open'));
    expect(response.statusCode, response.body).toBe(expected);
  });

  it.each(
    DETAIL_OPERATIONS.map(
      (operation) => [operation.name, operation.closedAdmin, operation] as const,
    ),
  )(
    'proyecto cerrado (solo lectura, FR-013): %s — administrador → %i',
    async (_name, expected, operation) => {
      const response = await runDetail(operation, 'administrador', await detailContext('closed'));
      expect(response.statusCode, response.body).toBe(expected);
    },
  );

  it.each(DETAIL_OPERATIONS.map((operation) => [operation.name, operation] as const))(
    'un proyecto en deleting responde 404: %s — administrador',
    async (_name, operation) => {
      const response = await runDetail(operation, 'administrador', await detailContext('deleting'));
      expect(response.statusCode).toBe(404);
    },
  );
});
