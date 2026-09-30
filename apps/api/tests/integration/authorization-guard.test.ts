import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { projectsModel, type Project } from '../../src/modules/projects/model';
import { authPlugin } from '../../src/plugins/auth';
import { authorizationPlugin } from '../../src/plugins/authorization';
import { buildTestApp, closeTestApp, TEST_JWT_SECRET } from '../helpers/app';

let app: FastifyInstance;
const admin = new Types.ObjectId();
const participant = new Types.ObjectId();
const outsider = new Types.ObjectId();
const resources = new Map<string, { projectId: Types.ObjectId; label: string }>();
const ids: Record<Project['status'], Types.ObjectId> = {
  draft: new Types.ObjectId(),
  open: new Types.ObjectId(),
  closed: new Types.ObjectId(),
  deleting: new Types.ObjectId(),
};

beforeAll(async () => {
  ({ app } = await buildTestApp('guard'));
  await app.register(authPlugin, { secret: TEST_JWT_SECRET, accessTtl: '15m' });
  await app.register(authorizationPlugin);

  const member = { preHandler: [app.requireAuth, app.requireProjectRole('member')] };
  const adminOnly = { preHandler: [app.requireAuth, app.requireProjectRole('admin')] };
  const writable = {
    preHandler: [
      app.requireAuth,
      app.requireProjectRole('member'),
      app.requireProjectStatus('open'),
    ],
  };
  const echo = async (request: { project?: Project; membership?: { role: string } }) => ({
    name: request.project?.name,
    role: request.membership?.role,
  });
  app.get('/projects/:projectId/ver', member, echo);
  app.get('/projects/:projectId/admin', adminOnly, echo);
  app.post('/projects/:projectId/aporte', writable, echo);
  app.post(
    '/projects/:projectId/diagrama',
    {
      preHandler: [
        app.requireAuth,
        app.requireProjectRole('admin'),
        app.requireProjectStatus(['draft', 'open']),
      ],
    },
    echo,
  );

  // Rutas por recurso: el recurso trae su proyecto (p. ej., /activities/:id).
  const loadResource = async (id: string) => resources.get(id) ?? null;
  const resourceEcho = async (request: {
    project?: Project;
    membership?: { role: string };
    resource?: unknown;
  }) => ({ ...(await echo(request)), resource: request.resource });
  app.get(
    '/recursos/:id',
    { preHandler: [app.requireAuth, app.requireResourceProject(loadResource)] },
    resourceEcho,
  );
  app.patch(
    '/recursos/:id',
    {
      preHandler: [
        app.requireAuth,
        app.requireResourceProject(loadResource, 'admin'),
        app.requireProjectStatus(['draft', 'open']),
      ],
    },
    resourceEcho,
  );
  await app.ready();

  const members = [
    { userId: admin, role: 'admin', joinedAt: new Date() },
    { userId: participant, role: 'participant', joinedAt: new Date() },
  ];
  await projectsModel(app.mongo).insertMany(
    Object.entries(ids).map(([status, _id]) => ({
      _id,
      name: `Proyecto ${status}`,
      status,
      ownerId: admin,
      members,
    })),
  );
});

afterAll(() => closeTestApp(app));

const resourceIn = (status: Project['status']) => {
  const id = new Types.ObjectId().toHexString();
  resources.set(id, { projectId: ids[status], label: `recurso ${status}` });
  return id;
};

const as = (user: Types.ObjectId) => ({
  authorization: `Bearer ${app.signAccessToken(user.toHexString(), 'sid')}`,
});
const call = (method: 'GET' | 'POST', user: Types.ObjectId, path: string) =>
  app.inject({ method, url: path, headers: as(user) });

describe('requireProjectRole (research R7)', () => {
  it('un miembro accede y la ruta recibe el proyecto y su membresía', async () => {
    const response = await call('GET', participant, `/projects/${ids.open}/ver`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: 'Proyecto open', role: 'participant' });
  });

  it('un no miembro recibe 404, como si el proyecto no existiera', async () => {
    const response = await call('GET', outsider, `/projects/${ids.open}/ver`);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'NOT_FOUND', message: 'Proyecto no encontrado' });
  });

  it.each([
    ['un id inexistente', new Types.ObjectId().toHexString()],
    ['un id mal formado', 'no-es-un-id'],
  ])('%s responde 404', async (_caso, projectId) => {
    expect((await call('GET', admin, `/projects/${projectId}/ver`)).statusCode).toBe(404);
  });

  it('un proyecto en deleting responde 404 a todos, incluido su Administrador', async () => {
    expect((await call('GET', admin, `/projects/${ids.deleting}/ver`)).statusCode).toBe(404);
  });

  it('un participante recibe 403 en una ruta de Administrador', async () => {
    const response = await call('GET', participant, `/projects/${ids.open}/admin`);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('un Administrador accede a las rutas de Administrador', async () => {
    const response = await call('GET', admin, `/projects/${ids.open}/admin`);
    expect(response.json()).toEqual({ name: 'Proyecto open', role: 'admin' });
  });

  it('sin sesión responde 401 antes de consultar el proyecto', async () => {
    const response = await app.inject({ url: `/projects/${ids.open}/ver` });
    expect(response.statusCode).toBe(401);
  });

  it('la membresía se consulta en cada petición: retirar a alguien surte efecto de inmediato', async () => {
    const extra = new Types.ObjectId();
    await projectsModel(app.mongo).updateOne(
      { _id: ids.draft },
      { $push: { members: { userId: extra, role: 'participant', joinedAt: new Date() } } },
    );
    expect((await call('GET', extra, `/projects/${ids.draft}/ver`)).statusCode).toBe(200);

    await projectsModel(app.mongo).updateOne(
      { _id: ids.draft },
      { $pull: { members: { userId: extra } } },
    );
    expect((await call('GET', extra, `/projects/${ids.draft}/ver`)).statusCode).toBe(404);
  });
});

describe('requireProjectStatus (spec US2 escenario 3)', () => {
  it('permite escribir en un proyecto abierto', async () => {
    expect((await call('POST', participant, `/projects/${ids.open}/aporte`)).statusCode).toBe(200);
  });

  it.each(['draft', 'closed'] as const)('responde 409 en un proyecto %s', async (status) => {
    const response = await call('POST', participant, `/projects/${ids[status]}/aporte`);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PROJECT_NOT_OPEN' });
  });

  it('carga el proyecto una sola vez aunque se encadenen los dos guards', async () => {
    const findOne = vi.spyOn(projectsModel(app.mongo), 'findOne');
    await call('POST', participant, `/projects/${ids.open}/aporte`);
    expect(findOne).toHaveBeenCalledTimes(1);
    findOne.mockRestore();
  });
});

describe('requireProjectStatus con lista (003, plan ajuste 5)', () => {
  it.each(['draft', 'open'] as const)('permite escribir en un proyecto %s', async (status) => {
    expect((await call('POST', admin, `/projects/${ids[status]}/diagrama`)).statusCode).toBe(200);
  });

  it('un proyecto cerrado queda en solo lectura: 409 PROJECT_CLOSED', async () => {
    const response = await call('POST', admin, `/projects/${ids.closed}/diagrama`);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PROJECT_CLOSED' });
  });
});

describe('requireResourceProject (rutas por recurso)', () => {
  it('carga el recurso, deduce su proyecto y aplica la membresía', async () => {
    const id = resourceIn('open');
    const response = await call('GET', participant, `/recursos/${id}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      name: 'Proyecto open',
      role: 'participant',
      resource: { projectId: ids.open.toHexString(), label: 'recurso open' },
    });
  });

  it('un no miembro recibe 404, igual que si el recurso no existiera', async () => {
    const response = await call('GET', outsider, `/recursos/${resourceIn('open')}`);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    ['inexistente', () => new Types.ObjectId().toHexString()],
    ['mal formado', () => 'no-es-un-id'],
    ['de un proyecto en deleting', () => resourceIn('deleting')],
  ])('un recurso %s responde 404', async (_caso, id) => {
    expect((await call('GET', admin, `/recursos/${id()}`)).statusCode).toBe(404);
  });

  it('exige el rol pedido: un participante recibe 403', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/recursos/${resourceIn('open')}`,
      headers: as(participant),
    });
    expect(response.statusCode).toBe(403);
  });

  it('se combina con requireProjectStatus: 409 si el proyecto del recurso está cerrado', async () => {
    const patch = (id: string) =>
      app.inject({ method: 'PATCH', url: `/recursos/${id}`, headers: as(admin) });
    expect((await patch(resourceIn('draft'))).statusCode).toBe(200);
    expect((await patch(resourceIn('closed'))).statusCode).toBe(409);
  });
});
