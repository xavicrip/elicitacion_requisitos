import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '../../src/lib/errors';
import { versionsModel } from '../../src/modules/diagrams/models/version';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { uploadDiagram } from '../helpers/diagrams';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser } from '../helpers/users';

// Plan de la 006, ajuste 6: otras features impiden publicar sin que el módulo de diagramas las
// conozca (la detección, con propuestas pendientes).

let app: FastifyInstance;
let admin: Record<string, string>;
let projectId: string;
const blocked = new Set<string>();

beforeAll(async () => {
  ({ app } = await buildTestApp('publishguards', { withAuth: true }));
  await app.ready();
  const ana = await registerTestUser(app, 'Ana');
  admin = authHeaders(ana);
  projectId = await seedProject(app, { status: 'open', members: [[ana, 'admin']] });
  app.registerPublishGuard('pruebas', async (version) =>
    blocked.has(version._id.toHexString())
      ? new HttpError(
          422,
          'PENDING_TEST',
          'Revisa lo pendiente antes de publicar.',
          {},
          undefined,
          {
            pending: 2,
          },
        )
      : null,
  );
});
afterAll(() => closeTestApp(app));

async function draftWithActivity() {
  const version = (await uploadDiagram(app, admin, projectId)).json();
  await app.inject({
    method: 'POST',
    url: `/diagram-versions/${version.id}/activities`,
    headers: admin,
    payload: { label: 'Validar pago', type: 'action', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
  });
  return version.id as string;
}

const publish = (versionId: string) =>
  app.inject({ method: 'POST', url: `/diagram-versions/${versionId}/publish`, headers: admin });

describe('condiciones de publicación', () => {
  it('una condición que falla bloquea con su error y no cambia la versión', async () => {
    const versionId = await draftWithActivity();
    blocked.add(versionId);
    const response = await publish(versionId);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'PENDING_TEST',
      message: 'Revisa lo pendiente antes de publicar.',
      pending: 2,
    });
    const version = await versionsModel(app.mongo).findById(versionId).lean();
    expect(version).toMatchObject({ status: 'draft', rev: 0 });
  });

  it('cuando se cumple, publica como siempre', async () => {
    const versionId = await draftWithActivity();
    blocked.delete(versionId);
    expect((await publish(versionId)).statusCode).toBe(200);
  });

  it('un nombre repetido es un error de programación', () => {
    expect(() => app.registerPublishGuard('pruebas', async () => null)).toThrow(/duplicad/);
  });
});
