import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogsModel } from '../../src/modules/audit/model';
import { invitationsModel } from '../../src/modules/invitations/model';
import { projectsModel, type Project } from '../../src/modules/projects/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

let app: FastifyInstance;
let ana: TestUser;
/** Proyectos que ha procesado el manejador de cascada de prueba, y fallos simulados. */
const cascaded: string[] = [];
const failuresLeft = new Map<string, number>();

beforeAll(async () => {
  ({ app } = await buildTestApp('deletion', {
    withAuth: true,
    // Reintentos rápidos para la prueba (en producción: exponencial desde 5 s).
    deletion: { attempts: 3, backoffMs: 10 },
  }));
  // Como hará la feature 003 con los diagramas: un manejador idempotente y reintentable.
  app.registerProjectCascade('prueba', async (projectId) => {
    const id = projectId.toHexString();
    const left = failuresLeft.get(id) ?? 0;
    if (left > 0) {
      failuresLeft.set(id, left - 1);
      throw new Error('fallo simulado del almacenamiento');
    }
    cascaded.push(id);
  });
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
});

afterAll(() => closeTestApp(app));

async function createProject(name: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/projects',
    headers: authHeaders(ana),
    payload: { name },
  });
  return response.json().id;
}

const remove = (id: string, confirmName: string) =>
  app.inject({
    method: 'DELETE',
    url: `/projects/${id}`,
    headers: authHeaders(ana),
    payload: { confirmName },
  });

/** Espera a que el job deje `deletion.status` en `status`. */
async function waitForDeletion(id: string, status: string): Promise<Project> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const project = await projectsModel(app.mongo).findById(id).lean<Project>();
    if (project?.deletion?.status === status) return project;
    if (Date.now() > deadline) {
      throw new Error(`deletion.status = ${project?.deletion?.status}, se esperaba ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('eliminar un proyecto (US2 escenario 4, research R9)', () => {
  it('sin el nombre exacto responde 400 y no toca el proyecto', async () => {
    const id = await createProject('Tienda en línea');
    const response = await remove(id, 'tienda en linea');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
    expect((await projectsModel(app.mongo).findById(id).lean())?.status).toBe('draft');
  });

  it('con el nombre exacto responde 202 y el proyecto deja de existir para todos', async () => {
    const id = await createProject('Para borrar');
    const response = await remove(id, 'Para borrar');
    expect(response.statusCode).toBe(202);

    expect(
      (await app.inject({ url: `/projects/${id}`, headers: authHeaders(ana) })).statusCode,
    ).toBe(404);
    const list = (await app.inject({ url: '/projects', headers: authHeaders(ana) })).json();
    expect(list.map((p: { id: string }) => p.id)).not.toContain(id);
    const event = await auditLogsModel(app.mongo)
      .findOne({ projectId: new Types.ObjectId(id), action: 'project.deletion_requested' })
      .lean();
    expect(event?.actorId).toEqual(new Types.ObjectId(ana.id));
  });

  it('el job ejecuta la cascada, borra las invitaciones y deja el estado done sin datos del proyecto', async () => {
    const id = await createProject('Con invitaciones');
    await invitationsModel(app.mongo).create({
      projectId: new Types.ObjectId(id),
      tokenHash: `hash-${id}`,
      createdBy: new Types.ObjectId(ana.id),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await remove(id, 'Con invitaciones');

    const done = await waitForDeletion(id, 'done');
    expect(cascaded).toContain(id);
    expect(done).toMatchObject({ status: 'deleting', name: '', description: '', members: [] });
    expect(done.deletion?.attempts).toBe(1);
    expect(
      await invitationsModel(app.mongo).countDocuments({ projectId: new Types.ObjectId(id) }),
    ).toBe(0);
  });

  it('reintenta tras un fallo y termina en done (manejadores idempotentes)', async () => {
    const id = await createProject('Con un fallo');
    failuresLeft.set(id, 1);
    await remove(id, 'Con un fallo');
    const done = await waitForDeletion(id, 'done');
    expect(done.deletion?.attempts).toBe(2);
    expect(cascaded.filter((c) => c === id)).toHaveLength(1);
  });

  it('agotados los reintentos queda failed con los intentos y el error (constitución VI)', async () => {
    const id = await createProject('Siempre falla');
    failuresLeft.set(id, 99);
    await remove(id, 'Siempre falla');
    const failed = await waitForDeletion(id, 'failed');
    expect(failed.deletion).toMatchObject({
      attempts: 3,
      error: 'fallo simulado del almacenamiento',
    });
    // Sigue oculto: un borrado fallido no vuelve a mostrar el proyecto.
    expect(
      (await app.inject({ url: `/projects/${id}`, headers: authHeaders(ana) })).statusCode,
    ).toBe(404);
  });

  it('pedir el borrado dos veces no encola dos jobs', async () => {
    const id = await createProject('Dos veces');
    await remove(id, 'Dos veces');
    // Ya está en `deleting`: el guard responde 404, como a cualquier recurso inexistente.
    expect((await remove(id, 'Dos veces')).statusCode).toBe(404);
  });
});
