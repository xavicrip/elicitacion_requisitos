import type { DomainEventName } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { createDetail, publishedDiagram } from '../helpers/details';
import { uploadDiagram } from '../helpers/diagrams';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Plan de la 005, ajuste 4: publicar, cambiar el estado del proyecto, retirar o salir un
// miembro y borrar el proyecto emiten su evento de dominio después de confirmar la escritura.

let app: FastifyInstance;
let ana: TestUser;
let luis: TestUser;
let events: Array<{ name: DomainEventName; payload: Record<string, unknown> }>;

beforeAll(async () => {
  ({ app } = await buildTestApp('domainevents', { withAuth: true }));
  await app.ready();
  app.domainEvents.onAny((name, payload) => {
    events.push({ name, payload: payload as Record<string, unknown> });
  });
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
});
afterAll(() => closeTestApp(app));
beforeEach(() => {
  events = [];
});

const project = (status: 'draft' | 'open' | 'closed' = 'open') =>
  seedProject(app, {
    status,
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
    ],
  });
const named = (name: DomainEventName) => events.filter((event) => event.name === name);

describe('eventos de diagramas', () => {
  it('publicar una versión emite diagram.published con la versión', async () => {
    const projectId = await project();
    const { diagramId, versionId } = await publishedDiagram(app, authHeaders(ana), projectId);
    expect(named('diagram.published')).toEqual([
      {
        name: 'diagram.published',
        payload: {
          projectId,
          diagramId,
          versionId,
          actorId: ana.id,
          at: expect.any(String),
        },
      },
    ]);
  });

  it('una publicación rechazada no emite nada', async () => {
    const projectId = await project();
    const version = (await uploadDiagram(app, authHeaders(ana), projectId)).json();
    const response = await app.inject({
      method: 'POST',
      url: `/diagram-versions/${version.id}/publish`,
      headers: authHeaders(ana),
    });
    expect(response.statusCode).toBe(422);
    expect(named('diagram.published')).toEqual([]);
  });
});

describe('eventos de proyectos y miembros', () => {
  it('cambiar el estado emite project.status_changed con el origen y el destino', async () => {
    const projectId = await project('open');
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/status`,
      headers: authHeaders(ana),
      payload: { action: 'close' },
    });
    expect(response.statusCode).toBe(200);
    expect(named('project.status_changed')).toEqual([
      {
        name: 'project.status_changed',
        payload: { projectId, from: 'open', to: 'closed', actorId: ana.id, at: expect.any(String) },
      },
    ]);
  });

  it('una transición inválida no emite nada', async () => {
    const projectId = await project('draft');
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/status`,
      headers: authHeaders(ana),
      payload: { action: 'close' },
    });
    expect(response.statusCode).toBe(409);
    expect(named('project.status_changed')).toEqual([]);
  });

  it('retirar a un miembro emite member.removed; salir, member.left', async () => {
    const projectId = await project();
    const removed = await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/members/${luis.id}`,
      headers: authHeaders(ana),
    });
    expect(removed.statusCode).toBe(204);
    expect(named('member.removed')).toEqual([
      {
        name: 'member.removed',
        payload: { projectId, userId: luis.id, actorId: ana.id, at: expect.any(String) },
      },
    ]);

    const other = await project();
    await app.inject({
      method: 'DELETE',
      url: `/projects/${other}/members/${luis.id}`,
      headers: authHeaders(luis),
    });
    expect(named('member.left')).toEqual([
      {
        name: 'member.left',
        payload: { projectId: other, userId: luis.id, actorId: luis.id, at: expect.any(String) },
      },
    ]);
  });

  it('retirar al último Administrador falla y no emite nada', async () => {
    const projectId = await project();
    const response = await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}/members/${ana.id}`,
      headers: authHeaders(ana),
    });
    expect(response.statusCode).toBe(409);
    expect(named('member.left')).toEqual([]);
  });

  it('borrar el proyecto emite project.deleted; con el nombre equivocado, nada', async () => {
    const projectId = await project();
    const name = (
      await app.inject({ url: `/projects/${projectId}`, headers: authHeaders(ana) })
    ).json().name;
    const wrong = await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}`,
      headers: authHeaders(ana),
      payload: { confirmName: 'otro' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(named('project.deleted')).toEqual([]);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}`,
      headers: authHeaders(ana),
      payload: { confirmName: name },
    });
    expect(deleted.statusCode).toBe(202);
    expect(named('project.deleted')).toEqual([
      {
        name: 'project.deleted',
        payload: { projectId, actorId: ana.id, at: expect.any(String) },
      },
    ]);
  });
});

describe('auditoría', () => {
  it('sigue registrando los eventos de detalles una sola vez, y no duplica los de proyecto', async () => {
    const projectId = await project();
    const { diagramId, keys } = await publishedDiagram(app, authHeaders(ana), projectId);
    expect(
      (await createDetail(app, authHeaders(luis), diagramId, keys['Validar pago']!)).statusCode,
    ).toBe(201);
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/status`,
      headers: authHeaders(ana),
      payload: { action: 'close' },
    });
    const logs = await app.mongo
      .collection('audit_logs')
      .find({ projectId: new Types.ObjectId(projectId) })
      .toArray();
    const count = (event: string) => logs.filter((log) => log.action === event).length;
    expect(count('detail.created')).toBe(1);
    expect(count('diagram.published')).toBe(1);
    expect(count('project.status_changed')).toBe(1);
  });
});
