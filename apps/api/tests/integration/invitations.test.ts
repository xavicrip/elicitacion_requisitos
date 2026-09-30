import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogsModel } from '../../src/modules/audit/model';
import { invitationsModel } from '../../src/modules/invitations/model';
import { projectsModel } from '../../src/modules/projects/model';
import { usersModel } from '../../src/modules/users/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

let app: FastifyInstance;
let ana: TestUser;

beforeAll(async () => {
  ({ app } = await buildTestApp('invitations', { withAuth: true }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
});

afterAll(() => closeTestApp(app));

const oid = (id: string) => new Types.ObjectId(id);
const tokenOf = (url: string) => url.split('/invitacion/')[1]!;

async function invite(projectId: string, by: TestUser = ana) {
  const response = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/invitations`,
    headers: authHeaders(by),
  });
  return response.json() as { id: string; url: string };
}

const accept = (token: string, user: TestUser) =>
  app.inject({ method: 'POST', url: `/invitations/${token}/accept`, headers: authHeaders(user) });

const membersOf = async (projectId: string) =>
  (await projectsModel(app.mongo).findById(projectId).lean())!.members;

describe('invitaciones (FR-008, research R8)', () => {
  it('el token solo viaja en la URL de la respuesta; en la base de datos se guarda su SHA-256', async () => {
    const projectId = await seedProject(app, { members: [[ana, 'admin']] });
    const { id, url } = await invite(projectId);
    const token = tokenOf(url);
    const stored = await invitationsModel(app.mongo).findById(id).lean();
    expect(stored?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(token);

    const list = await app.inject({
      url: `/projects/${projectId}/invitations`,
      headers: authHeaders(ana),
    });
    expect(list.body).not.toContain(token);
  });

  it('caduca a los 7 días (US3 escenario 1)', async () => {
    const projectId = await seedProject(app, { members: [[ana, 'admin']] });
    const { id } = await invite(projectId);
    const stored = await invitationsModel(app.mongo).findById(id).lean();
    const days = (stored!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('una persona autenticada se une como Participante y cuenta el uso (US3 escenario 2)', async () => {
    const projectId = await seedProject(app, { members: [[ana, 'admin']] });
    const { id, url } = await invite(projectId);
    const luis = await registerTestUser(app, 'Luis');

    const response = await accept(tokenOf(url), luis);
    expect(response.statusCode).toBe(200);
    expect(await membersOf(projectId)).toContainEqual(
      expect.objectContaining({ userId: oid(luis.id), role: 'participant' }),
    );
    expect((await invitationsModel(app.mongo).findById(id).lean())?.uses).toBe(1);
  });

  it('aceptar es idempotente: no duplica al miembro y conserva su rol', async () => {
    const projectId = await seedProject(app, { members: [[ana, 'admin']] });
    const { url } = await invite(projectId);
    const luis = await registerTestUser(app, 'Luis');
    await accept(tokenOf(url), luis);
    await accept(tokenOf(url), luis);
    expect((await membersOf(projectId)).filter((m) => m.userId.equals(luis.id))).toHaveLength(1);

    // Un Administrador que abre el enlace sigue siendo Administrador.
    const response = await accept(tokenOf(url), ana);
    expect(response.json()).toMatchObject({ myRole: 'admin' });
  });

  it('el enlace es multiuso hasta que se revoca o caduca', async () => {
    const projectId = await seedProject(app, { members: [[ana, 'admin']] });
    const { url } = await invite(projectId);
    for (const name of ['Uno', 'Dos', 'Tres']) {
      expect((await accept(tokenOf(url), await registerTestUser(app, name))).statusCode).toBe(200);
    }
    expect(await membersOf(projectId)).toHaveLength(4);
  });

  it('revocada o caducada responde 410 y no une a nadie (US3 escenario 3)', async () => {
    const projectId = await seedProject(app, { members: [[ana, 'admin']] });
    const revoked = await invite(projectId);
    await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/invitations/${revoked.id}`,
      headers: authHeaders(ana),
    });
    const expired = await invite(projectId);
    await invitationsModel(app.mongo).updateOne(
      { _id: expired.id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    const luis = await registerTestUser(app, 'Luis');
    for (const { url } of [revoked, expired]) {
      const preview = await app.inject({ url: `/invitations/${tokenOf(url)}` });
      expect(preview.statusCode).toBe(410);
      expect(preview.json()).toEqual({
        code: 'INVITATION_INVALID',
        message: 'Esta invitación ya no es válida',
      });
      expect((await accept(tokenOf(url), luis)).statusCode).toBe(410);
    }
    expect(await membersOf(projectId)).toHaveLength(1);
  });

  it('el listado muestra el estado derivado: active, revoked y expired', async () => {
    const projectId = await seedProject(app, { members: [[ana, 'admin']] });
    const active = await invite(projectId);
    const revoked = await invite(projectId);
    const expired = await invite(projectId);
    await invitationsModel(app.mongo).updateOne(
      { _id: revoked.id },
      { $set: { revokedAt: new Date() } },
    );
    await invitationsModel(app.mongo).updateOne(
      { _id: expired.id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const list = (
      await app.inject({ url: `/projects/${projectId}/invitations`, headers: authHeaders(ana) })
    ).json() as Array<{ id: string; status: string }>;
    expect(Object.fromEntries(list.map((i) => [i.id, i.status]))).toEqual({
      [active.id]: 'active',
      [revoked.id]: 'revoked',
      [expired.id]: 'expired',
    });
  });

  it('una invitación de un proyecto en borrado ya no es válida', async () => {
    const projectId = await seedProject(app, { members: [[ana, 'admin']] });
    const { url } = await invite(projectId);
    await projectsModel(app.mongo).updateOne({ _id: projectId }, { $set: { status: 'deleting' } });
    expect((await app.inject({ url: `/invitations/${tokenOf(url)}` })).statusCode).toBe(410);
  });

  it('no se puede revocar una invitación de otro proyecto', async () => {
    const mine = await seedProject(app, { members: [[ana, 'admin']] });
    const theirs = await seedProject(app, { members: [[ana, 'admin']] });
    const { id } = await invite(theirs);
    const response = await app.inject({
      method: 'DELETE',
      url: `/projects/${mine}/invitations/${id}`,
      headers: authHeaders(ana),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('miembros (FR-009, FR-010, research R6)', () => {
  async function projectWith(...members: Array<[TestUser, 'admin' | 'participant']>) {
    return seedProject(app, { members });
  }
  const patchRole = (projectId: string, userId: string, role: string, by: TestUser = ana) =>
    app.inject({
      method: 'PATCH',
      url: `/projects/${projectId}/members/${userId}`,
      headers: authHeaders(by),
      payload: { role },
    });
  const removeMember = (projectId: string, userId: string, by: TestUser = ana) =>
    app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/members/${userId}`,
      headers: authHeaders(by),
    });

  it('lista los miembros con nombre, email, rol y fecha de unión', async () => {
    const luis = await registerTestUser(app, 'Luis');
    const projectId = await projectWith([ana, 'admin'], [luis, 'participant']);
    const members = (
      await app.inject({ url: `/projects/${projectId}/members`, headers: authHeaders(luis) })
    ).json();
    expect(members).toContainEqual(
      expect.objectContaining({
        userId: luis.id,
        name: luis.name,
        email: luis.email,
        role: 'participant',
      }),
    );
  });

  it('promover a Administrador da todos los permisos (US3 escenario 5), con auditoría', async () => {
    const luis = await registerTestUser(app, 'Luis');
    const projectId = await projectWith([ana, 'admin'], [luis, 'participant']);
    expect((await patchRole(projectId, luis.id, 'admin')).statusCode).toBe(200);
    // Ya puede hacer lo que solo hace un Administrador.
    const invitation = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/invitations`,
      headers: authHeaders(luis),
    });
    expect(invitation.statusCode).toBe(201);
    const event = await auditLogsModel(app.mongo)
      .findOne({ projectId: oid(projectId), action: 'member.role_changed' })
      .lean();
    expect(event).toMatchObject({
      actorId: oid(ana.id),
      entity: { type: 'member', id: luis.id },
      diff: { role: { from: 'participant', to: 'admin' } },
    });
  });

  it('el último Administrador no puede degradarse ni abandonar el proyecto (edge case)', async () => {
    const luis = await registerTestUser(app, 'Luis');
    const projectId = await projectWith([ana, 'admin'], [luis, 'participant']);
    for (const response of [
      await patchRole(projectId, ana.id, 'participant'),
      await removeMember(projectId, ana.id),
    ]) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        code: 'LAST_ADMIN',
        message: 'El proyecto necesita al menos un Administrador',
      });
    }
    expect(await membersOf(projectId)).toContainEqual(
      expect.objectContaining({ userId: oid(ana.id), role: 'admin' }),
    );
  });

  it('con otro Administrador, sí puede degradarse', async () => {
    const bea = await registerTestUser(app, 'Bea');
    const projectId = await projectWith([ana, 'admin'], [bea, 'admin']);
    expect((await patchRole(projectId, ana.id, 'participant')).statusCode).toBe(200);
  });

  it('dos Administradores que se degradan a la vez no dejan el proyecto sin ninguno', async () => {
    const bea = await registerTestUser(app, 'Bea');
    const projectId = await projectWith([ana, 'admin'], [bea, 'admin']);
    const results = await Promise.all([
      patchRole(projectId, ana.id, 'participant', ana),
      patchRole(projectId, bea.id, 'participant', bea),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await membersOf(projectId)).filter((m) => m.role === 'admin')).toHaveLength(1);
  });

  it('retirar a un Participante le quita el acceso en su siguiente petición (US3 escenario 4)', async () => {
    const luis = await registerTestUser(app, 'Luis');
    const projectId = await projectWith([ana, 'admin'], [luis, 'participant']);
    expect(
      (await app.inject({ url: `/projects/${projectId}`, headers: authHeaders(luis) })).statusCode,
    ).toBe(200);

    expect((await removeMember(projectId, luis.id)).statusCode).toBe(204);
    expect(
      (await app.inject({ url: `/projects/${projectId}`, headers: authHeaders(luis) })).statusCode,
    ).toBe(404);

    // Su cuenta y lo que lo referencia se conservan (la 004 añade el caso con aportes).
    expect(await usersModel(app.mongo).exists({ _id: luis.id })).toBeTruthy();
    const event = await auditLogsModel(app.mongo)
      .findOne({ projectId: oid(projectId), action: 'member.removed' })
      .lean();
    expect(event).toMatchObject({ actorId: oid(ana.id), entity: { type: 'member', id: luis.id } });
  });

  it('un Participante puede abandonar el proyecto', async () => {
    const luis = await registerTestUser(app, 'Luis');
    const projectId = await projectWith([ana, 'admin'], [luis, 'participant']);
    expect((await removeMember(projectId, luis.id, luis)).statusCode).toBe(204);
    expect(await membersOf(projectId)).toHaveLength(1);
  });

  it('cambiar el rol o retirar a alguien que no es miembro responde 404', async () => {
    const projectId = await projectWith([ana, 'admin']);
    const stranger = await registerTestUser(app, 'Ajeno');
    expect((await patchRole(projectId, stranger.id, 'admin')).statusCode).toBe(404);
    expect((await removeMember(projectId, stranger.id)).statusCode).toBe(404);
    expect((await removeMember(projectId, 'no-es-un-id')).statusCode).toBe(404);
  });

  it('auditoría de invitaciones: creada y revocada, sin el token', async () => {
    const projectId = await projectWith([ana, 'admin']);
    const { id, url } = await invite(projectId);
    await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/invitations/${id}`,
      headers: authHeaders(ana),
    });
    const events = await auditLogsModel(app.mongo)
      .find({ projectId: oid(projectId), action: /^invitation\./ })
      .sort({ at: 1 })
      .lean();
    expect(events.map((e) => e.action)).toEqual(['invitation.created', 'invitation.revoked']);
    expect(JSON.stringify(events)).not.toContain(tokenOf(url));
  });
});
