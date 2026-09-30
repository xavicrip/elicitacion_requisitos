import {
  DiagramSummarySchema,
  DiagramVersionSchema,
  VersionWithActivitiesSchema,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { DIAGRAM_FLAGS, markPublished, uploadDiagram, uploadVersion } from '../helpers/diagrams';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser } from '../helpers/users';

// Contrato: specs/003-diagramas-canvas/contracts/diagrams.openapi.yaml.
const ErrorSchema = z.object({ code: z.string(), message: z.string() });

let app: FastifyInstance;
let admin: Record<string, string>;
let projectId: string;
let version: z.infer<typeof DiagramVersionSchema>;

beforeAll(async () => {
  ({ app } = await buildTestApp('diagramscontract', {
    withAuth: true,
    featureFlags: DIAGRAM_FLAGS,
  }));
  await app.ready();
  const user = await registerTestUser(app);
  admin = authHeaders(user);
  projectId = await seedProject(app, { status: 'open', members: [[user, 'admin']] });
  version = (await uploadDiagram(app, admin, projectId)).json();
});

afterAll(() => closeTestApp(app));

describe('/projects/{projectId}/diagrams', () => {
  it('POST 201 (multipart) devuelve la DiagramVersion 1 en borrador', async () => {
    const response = await uploadDiagram(app, admin, projectId, { name: 'Otro' });
    expect(response.statusCode).toBe(201);
    expect(DiagramVersionSchema.strict().parse(response.json())).toMatchObject({
      number: 1,
      status: 'draft',
      publishedAt: null,
      image: { width: 900, height: 1200 },
    });
  });

  it('POST 415 con el formato de error', async () => {
    const response = await uploadDiagram(app, admin, projectId, {
      file: 'doc.pdf',
      buffer: Buffer.from('%PDF-1.7\n%%EOF'),
    });
    expect(response.statusCode).toBe(415);
    ErrorSchema.parse(response.json());
  });

  it('GET 200 devuelve un array de DiagramSummary', async () => {
    const response = await app.inject({ url: `/projects/${projectId}/diagrams`, headers: admin });
    expect(response.statusCode).toBe(200);
    const list = z.array(DiagramSummarySchema.strict()).min(1).parse(response.json());
    expect(list[0]).toMatchObject({ draftVersionId: version.id, publishedVersionId: null });
  });
});

describe('/diagrams/{diagramId}/versions', () => {
  it('POST 409 con un borrador pendiente; 201 con la versión siguiente si no lo hay', async () => {
    const conflict = await uploadVersion(app, admin, version.diagramId);
    expect(conflict.statusCode).toBe(409);
    ErrorSchema.parse(conflict.json());

    await markPublished(app, version.id);
    const response = await uploadVersion(app, admin, version.diagramId);
    expect(response.statusCode).toBe(201);
    expect(DiagramVersionSchema.strict().parse(response.json())).toMatchObject({
      diagramId: version.diagramId,
      number: 2,
      status: 'draft',
    });
  });
});

describe('/diagram-versions/{versionId}', () => {
  it('GET 200 devuelve la versión con sus actividades', async () => {
    const response = await app.inject({ url: `/diagram-versions/${version.id}`, headers: admin });
    expect(response.statusCode).toBe(200);
    expect(VersionWithActivitiesSchema.strict().parse(response.json())).toMatchObject({
      id: version.id,
      activities: [],
      image: {
        displayUrl: `/api/diagram-versions/${version.id}/image/display`,
        thumbUrl: `/api/diagram-versions/${version.id}/image/thumb`,
      },
    });
  });

  it('GET 404 con el formato de error si no existe', async () => {
    const response = await app.inject({
      url: '/diagram-versions/64b7f0c2a1b2c3d4e5f60718',
      headers: admin,
    });
    expect(response.statusCode).toBe(404);
    ErrorSchema.parse(response.json());
  });
});

describe('/diagram-versions/{versionId}/image/{variant}', () => {
  it.each(['display', 'thumb'])('GET %s 200 devuelve WebP', async (variant) => {
    const response = await app.inject({
      url: `/diagram-versions/${version.id}/image/${variant}`,
      headers: admin,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.rawPayload.subarray(8, 12).toString()).toBe('WEBP');
  });

  it('GET 404 con una variante desconocida', async () => {
    const response = await app.inject({
      url: `/diagram-versions/${version.id}/image/original`,
      headers: admin,
    });
    expect(response.statusCode).toBe(404);
  });
});
