import {
  InvitationCreatedSchema,
  InvitationPreviewSchema,
  InvitationSchema,
  MemberSchema,
  ProjectSummarySchema,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Contrato: specs/002-auth-proyectos/contracts/auth-projects.openapi.yaml (miembros e
// invitaciones).
const ErrorSchema = z.object({ code: z.string(), message: z.string() });

let app: FastifyInstance;
let admin: TestUser;
let participant: TestUser;
let projectId: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('invitationscontract', { withAuth: true }));
  await app.ready();
  admin = await registerTestUser(app, 'Admin');
  participant = await registerTestUser(app, 'Luis');
  projectId = await seedProject(app, {
    name: 'Tienda en línea',
    members: [
      [admin, 'admin'],
      [participant, 'participant'],
    ],
  });
});

afterAll(() => closeTestApp(app));

const createInvitation = () =>
  app.inject({
    method: 'POST',
    url: `/projects/${projectId}/invitations`,
    headers: authHeaders(admin),
  });
const tokenOf = (url: string) => url.split('/invitacion/')[1]!;

describe('/projects/{projectId}/members', () => {
  it('GET 200 devuelve un array de Member', async () => {
    const response = await app.inject({
      url: `/projects/${projectId}/members`,
      headers: authHeaders(participant),
    });
    expect(response.statusCode).toBe(200);
    const members = z.array(MemberSchema.strict()).parse(response.json());
    expect(members.map((m) => m.role).sort()).toEqual(['admin', 'participant']);
  });

  it('PATCH 200 devuelve el Member con el rol nuevo', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${projectId}/members/${participant.id}`,
      headers: authHeaders(admin),
      payload: { role: 'admin' },
    });
    expect(response.statusCode).toBe(200);
    expect(MemberSchema.parse(response.json())).toMatchObject({ role: 'admin' });
  });

  it('PATCH 409 con el formato de error si dejaría el proyecto sin Administradores', async () => {
    const solo = await seedProject(app, { members: [[admin, 'admin']] });
    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${solo}/members/${admin.id}`,
      headers: authHeaders(admin),
      payload: { role: 'participant' },
    });
    expect(response.statusCode).toBe(409);
    ErrorSchema.parse(response.json());
  });

  it('DELETE 204 sin cuerpo', async () => {
    const other = await registerTestUser(app, 'Otra');
    const id = await seedProject(app, {
      members: [
        [admin, 'admin'],
        [other, 'participant'],
      ],
    });
    const response = await app.inject({
      method: 'DELETE',
      url: `/projects/${id}/members/${other.id}`,
      headers: authHeaders(admin),
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });
});

describe('/projects/{projectId}/invitations', () => {
  it('POST 201 devuelve la invitación con la URL (única vez que viaja el token)', async () => {
    const response = await createInvitation();
    expect(response.statusCode).toBe(201);
    const created = InvitationCreatedSchema.strict().parse(response.json());
    expect(created).toMatchObject({ status: 'active', uses: 0 });
    expect(created.url).toMatch(/^https:\/\/web\.example\.com\/invitacion\/[A-Za-z0-9_-]{43}$/);
  });

  it('GET 200 devuelve un array de Invitation sin token ni URL', async () => {
    await createInvitation();
    const response = await app.inject({
      url: `/projects/${projectId}/invitations`,
      headers: authHeaders(admin),
    });
    expect(response.statusCode).toBe(200);
    z.array(InvitationSchema.strict()).min(1).parse(response.json());
  });

  it('DELETE /{invitationId} 204 revoca la invitación', async () => {
    const { id } = (await createInvitation()).json();
    const response = await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/invitations/${id}`,
      headers: authHeaders(admin),
    });
    expect(response.statusCode).toBe(204);
  });
});

describe('/invitations/{token}', () => {
  it('GET 200 sin sesión devuelve la vista previa', async () => {
    const { url } = (await createInvitation()).json();
    const response = await app.inject({ url: `/invitations/${tokenOf(url)}` });
    expect(response.statusCode).toBe(200);
    expect(InvitationPreviewSchema.strict().parse(response.json())).toEqual({
      projectName: 'Tienda en línea',
    });
  });

  it('GET 410 con el formato de error para un token desconocido', async () => {
    const response = await app.inject({ url: '/invitations/no-existe' });
    expect(response.statusCode).toBe(410);
    expect(ErrorSchema.parse(response.json())).toMatchObject({ code: 'INVITATION_INVALID' });
  });

  it('POST /accept 200 devuelve el ProjectSummary', async () => {
    const { url } = (await createInvitation()).json();
    const newcomer = await registerTestUser(app, 'Nuevo');
    const response = await app.inject({
      method: 'POST',
      url: `/invitations/${tokenOf(url)}/accept`,
      headers: authHeaders(newcomer),
    });
    expect(response.statusCode).toBe(200);
    expect(ProjectSummarySchema.strict().parse(response.json())).toMatchObject({
      id: projectId,
      myRole: 'participant',
    });
  });

  it('POST /accept 401 sin sesión', async () => {
    const { url } = (await createInvitation()).json();
    const response = await app.inject({
      method: 'POST',
      url: `/invitations/${tokenOf(url)}/accept`,
    });
    expect(response.statusCode).toBe(401);
  });
});
