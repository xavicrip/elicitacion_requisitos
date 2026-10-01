import { DiagramVersionSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { uploadDiagram } from '../helpers/diagrams';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser } from '../helpers/users';

// Contrato: POST /diagram-versions/{versionId}/publish (diagrams.openapi.yaml).
const ErrorSchema = z.object({ code: z.string(), message: z.string() });

let app: FastifyInstance;
let admin: Record<string, string>;
let projectId: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('publishcontract', {
    withAuth: true,
  }));
  await app.ready();
  const user = await registerTestUser(app);
  admin = authHeaders(user);
  projectId = await seedProject(app, { status: 'open', members: [[user, 'admin']] });
});

afterAll(() => closeTestApp(app));

const publish = (versionId: string) =>
  app.inject({ method: 'POST', url: `/diagram-versions/${versionId}/publish`, headers: admin });

describe('/diagram-versions/{versionId}/publish', () => {
  it('POST 200 devuelve la DiagramVersion publicada', async () => {
    const { id } = (await uploadDiagram(app, admin, projectId)).json();
    await app.inject({
      method: 'POST',
      url: `/diagram-versions/${id}/activities`,
      headers: admin,
      payload: { label: 'Validar pago', type: 'action', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
    });
    const response = await publish(id);
    expect(response.statusCode).toBe(200);
    const version = DiagramVersionSchema.strict().parse(response.json());
    expect(version).toMatchObject({ id, status: 'published' });
    expect(version.publishedAt).toEqual(expect.any(String));
  });

  it('POST 422 sin actividades, con el formato de error', async () => {
    const { id } = (await uploadDiagram(app, admin, projectId, { name: 'Vacío' })).json();
    const response = await publish(id);
    expect(response.statusCode).toBe(422);
    ErrorSchema.parse(response.json());
  });
});
