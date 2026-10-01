import { DetailSchema, FacetsSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { createDetail, DETAIL_FLAGS, detailsUrl, publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser } from '../helpers/users';

// Contrato: specs/004-detalles-requisitos/contracts/details.openapi.yaml (alta, lista y facets).
const ErrorSchema = z.object({ code: z.string(), message: z.string() });

let app: FastifyInstance;
let admin: Record<string, string>;
let projectId: string;
let diagramId: string;
let key: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('detailscontract', { withAuth: true, featureFlags: DETAIL_FLAGS }));
  await app.ready();
  const user = await registerTestUser(app);
  admin = authHeaders(user);
  projectId = await seedProject(app, { status: 'open', members: [[user, 'admin']] });
  const diagram = await publishedDiagram(app, admin, projectId);
  diagramId = diagram.diagramId;
  key = diagram.keys['Validar pago']!;
});

afterAll(() => closeTestApp(app));

describe('/diagrams/{diagramId}/activities/{activityKey}/details', () => {
  it('POST 201 devuelve un Detail con su ETag', async () => {
    const response = await createDetail(app, admin, diagramId, key, { tags: ['Pagos'] });
    expect(response.statusCode).toBe(201);
    const detail = DetailSchema.strict().parse(response.json());
    expect(detail).toMatchObject({ activityKey: key, status: 'pending', rev: 0, tags: ['pagos'] });
    expect(response.headers.etag).toBe('"0"');
  });

  it('POST 400 con el formato de error y el campo', async () => {
    const response = await createDetail(app, admin, diagramId, key, { then: '' });
    expect(response.statusCode).toBe(400);
    expect(ErrorSchema.parse(response.json())).toBeTruthy();
    expect(response.json().fields).toHaveProperty('then');
  });

  it('POST 404 con el formato de error si la actividad no está publicada', async () => {
    const response = await createDetail(app, admin, diagramId, crypto.randomUUID());
    expect(response.statusCode).toBe(404);
    ErrorSchema.parse(response.json());
  });

  it('GET 200 devuelve un array de Detail', async () => {
    const response = await app.inject({ url: detailsUrl(diagramId, key), headers: admin });
    expect(response.statusCode).toBe(200);
    z.array(DetailSchema.strict()).min(1).parse(response.json());
  });
});

describe('/projects/{projectId}/details/facets', () => {
  it('GET 200 devuelve roles y etiquetas', async () => {
    const response = await app.inject({
      url: `/projects/${projectId}/details/facets`,
      headers: admin,
    });
    expect(response.statusCode).toBe(200);
    expect(FacetsSchema.strict().parse(response.json()).tags).toContainEqual({
      value: 'pagos',
      count: 1,
    });
  });
});
