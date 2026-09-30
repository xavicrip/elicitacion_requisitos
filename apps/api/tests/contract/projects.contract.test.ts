import { ProjectSchema, ProjectSummarySchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { authHeaders, registerTestUser } from '../helpers/users';

// Contrato: specs/002-auth-proyectos/contracts/auth-projects.openapi.yaml (/projects…).
const ErrorSchema = z.object({ code: z.string(), message: z.string() });

let app: FastifyInstance;
let admin: Record<string, string>;
let projectId: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('projectscontract', { withAuth: true }));
  await app.ready();
  admin = authHeaders(await registerTestUser(app));
  const created = await app.inject({
    method: 'POST',
    url: '/projects',
    headers: admin,
    payload: { name: 'Tienda en línea', description: 'Levantamiento inicial' },
  });
  projectId = created.json().id;
});

afterAll(() => closeTestApp(app));

describe('/projects', () => {
  it('POST 201 devuelve un Project', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: admin,
      payload: { name: 'Otro' },
    });
    expect(response.statusCode).toBe(201);
    expect(ProjectSchema.strict().parse(response.json())).toMatchObject({
      name: 'Otro',
      status: 'draft',
      myRole: 'admin',
      memberCount: 1,
    });
  });

  it('POST 400 con el formato de error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: admin,
      payload: { name: '' },
    });
    expect(response.statusCode).toBe(400);
    ErrorSchema.parse(response.json());
  });

  it('GET 200 devuelve un array de ProjectSummary', async () => {
    const response = await app.inject({ url: '/projects', headers: admin });
    expect(response.statusCode).toBe(200);
    z.array(ProjectSummarySchema.strict()).min(1).parse(response.json());
  });

  it('GET sin sesión responde 401', async () => {
    expect((await app.inject({ url: '/projects' })).statusCode).toBe(401);
  });
});

describe('/projects/{projectId}', () => {
  it('GET 200 devuelve el Project', async () => {
    const response = await app.inject({ url: `/projects/${projectId}`, headers: admin });
    expect(response.statusCode).toBe(200);
    expect(ProjectSchema.strict().parse(response.json())).toMatchObject({
      id: projectId,
      description: 'Levantamiento inicial',
    });
  });

  it('PATCH 200 devuelve el Project editado', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${projectId}`,
      headers: admin,
      payload: { name: 'Tienda en línea', description: 'Nueva descripción' },
    });
    expect(response.statusCode).toBe(200);
    expect(ProjectSchema.parse(response.json()).description).toBe('Nueva descripción');
  });

  it('GET 404 con el formato de error para un proyecto ajeno', async () => {
    const outsider = authHeaders(await registerTestUser(app));
    const response = await app.inject({ url: `/projects/${projectId}`, headers: outsider });
    expect(response.statusCode).toBe(404);
    ErrorSchema.parse(response.json());
  });
});

describe('/projects/{projectId}/status', () => {
  it('POST 200 devuelve el Project con el estado nuevo', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/status`,
      headers: admin,
      payload: { action: 'open' },
    });
    expect(response.statusCode).toBe(200);
    expect(ProjectSchema.parse(response.json()).status).toBe('open');
  });

  it('POST 409 con el formato de error si la transición no es válida', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/status`,
      headers: admin,
      payload: { action: 'reopen' },
    });
    expect(response.statusCode).toBe(409);
    ErrorSchema.parse(response.json());
  });

  it('POST 400 con una acción desconocida', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/status`,
      headers: admin,
      payload: { action: 'archive' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /projects/{projectId}', () => {
  it('400 con el formato de error si confirmName no coincide', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}`,
      headers: admin,
      payload: { confirmName: 'otro nombre' },
    });
    expect(response.statusCode).toBe(400);
    ErrorSchema.parse(response.json());
  });

  it('202 sin cuerpo con el nombre exacto', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}`,
      headers: admin,
      payload: { confirmName: 'Tienda en línea' },
    });
    expect(response.statusCode).toBe(202);
    expect(response.body).toBe('');
  });
});
