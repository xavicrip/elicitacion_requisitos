import { ActivitySchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { uploadDiagram } from '../helpers/diagrams';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser } from '../helpers/users';

// Contrato: specs/003-diagramas-canvas/contracts/diagrams.openapi.yaml (actividades).
const ErrorSchema = z.object({ code: z.string(), message: z.string() });
const bbox = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };

let app: FastifyInstance;
let admin: Record<string, string>;
let versionId: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('activitiescontract', {
    withAuth: true,
  }));
  await app.ready();
  const user = await registerTestUser(app);
  admin = authHeaders(user);
  const projectId = await seedProject(app, { status: 'open', members: [[user, 'admin']] });
  versionId = (await uploadDiagram(app, admin, projectId)).json().id;
});

afterAll(() => closeTestApp(app));

const create = (label = 'Validar pago') =>
  app.inject({
    method: 'POST',
    url: `/diagram-versions/${versionId}/activities`,
    headers: admin,
    payload: { label, type: 'action', bbox },
  });

describe('/diagram-versions/{versionId}/activities', () => {
  it('POST 201 devuelve una Activity con su ETag', async () => {
    const response = await create();
    expect(response.statusCode).toBe(201);
    const activity = ActivitySchema.strict().parse(response.json());
    expect(activity).toMatchObject({ label: 'Validar pago', rev: 0, source: 'manual', next: [] });
    expect(response.headers.etag).toBe('"0"');
  });

  it('POST 400 con el formato de error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/diagram-versions/${versionId}/activities`,
      headers: admin,
      payload: { label: '', type: 'action', bbox },
    });
    expect(response.statusCode).toBe(400);
    ErrorSchema.parse(response.json());
  });
});

describe('/activities/{activityId}', () => {
  it('PATCH 200 con If-Match devuelve la Activity y el nuevo ETag', async () => {
    const { id } = (await create()).json();
    const response = await app.inject({
      method: 'PATCH',
      url: `/activities/${id}`,
      headers: { ...admin, 'if-match': '"0"' },
      payload: { label: 'Emitir factura' },
    });
    expect(response.statusCode).toBe(200);
    expect(ActivitySchema.strict().parse(response.json())).toMatchObject({
      label: 'Emitir factura',
      rev: 1,
    });
    expect(response.headers.etag).toBe('"1"');
  });

  it('PATCH 409 devuelve la Activity actual; 428 sin If-Match', async () => {
    const { id } = (await create()).json();
    const stale = await app.inject({
      method: 'PATCH',
      url: `/activities/${id}`,
      headers: { ...admin, 'if-match': '"7"' },
      payload: { label: 'Otra' },
    });
    expect(stale.statusCode).toBe(409);
    expect(ActivitySchema.strict().parse(stale.json())).toMatchObject({ id, rev: 0 });

    const missing = await app.inject({
      method: 'PATCH',
      url: `/activities/${id}`,
      headers: admin,
      payload: { label: 'Otra' },
    });
    expect(missing.statusCode).toBe(428);
    ErrorSchema.parse(missing.json());
  });

  it('DELETE 204', async () => {
    const { id } = (await create()).json();
    const response = await app.inject({
      method: 'DELETE',
      url: `/activities/${id}`,
      headers: admin,
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });
});
