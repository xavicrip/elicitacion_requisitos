import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { DIAGRAM_FLAGS, markPublished, uploadDiagram } from '../helpers/diagrams';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser } from '../helpers/users';

// Plan ajuste 1: las imágenes las sirve api (mismo origen), con la membresía comprobada.

let app: FastifyInstance;
let admin: Record<string, string>;
let participant: Record<string, string>;
let outsider: Record<string, string>;
let draftId: string;
let publishedId: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('diagramimages', { withAuth: true, featureFlags: DIAGRAM_FLAGS }));
  await app.ready();
  const ana = await registerTestUser(app, 'Ana');
  const pablo = await registerTestUser(app, 'Pablo');
  admin = authHeaders(ana);
  participant = authHeaders(pablo);
  outsider = authHeaders(await registerTestUser(app, 'Olga'));
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [pablo, 'participant'],
    ],
  });
  publishedId = (await uploadDiagram(app, admin, projectId, { name: 'Publicado' })).json().id;
  await markPublished(app, publishedId);
  draftId = (await uploadDiagram(app, admin, projectId, { name: 'Borrador' })).json().id;
});

afterAll(() => closeTestApp(app));

const image = (versionId: string, headers: Record<string, string>, variant = 'display') =>
  app.inject({ url: `/diagram-versions/${versionId}/image/${variant}`, headers });

describe('GET /diagram-versions/:id/image/{display|thumb}', () => {
  it('sirve WebP con caché privada inmutable y ETag', async () => {
    const response = await image(publishedId, admin);
    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      'content-type': 'image/webp',
      'cache-control': 'private, max-age=31536000, immutable',
      etag: expect.stringMatching(/^".+"$/),
    });
    expect(Number(response.headers['content-length'])).toBe(response.rawPayload.length);
  });

  it('responde 304 sin cuerpo con If-None-Match', async () => {
    const { etag } = (await image(publishedId, admin, 'thumb')).headers;
    const response = await image(publishedId, { ...admin, 'if-none-match': String(etag) });
    // El ETag de la miniatura no vale para display.
    expect(response.statusCode).toBe(200);
    const cached = await image(publishedId, { ...admin, 'if-none-match': String(etag) }, 'thumb');
    expect(cached.statusCode).toBe(304);
    expect(cached.rawPayload.length).toBe(0);
    expect(cached.headers.etag).toBe(etag);
  });

  it('un Participante ve las versiones publicadas pero no los borradores (404)', async () => {
    expect((await image(publishedId, participant)).statusCode).toBe(200);
    expect((await image(draftId, participant)).statusCode).toBe(404);
    expect((await image(draftId, admin)).statusCode).toBe(200);
  });

  it('a quien no es miembro, 404; sin sesión, 401', async () => {
    expect((await image(publishedId, outsider)).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `/diagram-versions/${publishedId}/image/display` })).statusCode,
    ).toBe(401);
  });
});
