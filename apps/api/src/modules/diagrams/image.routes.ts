import type { FastifyInstance } from 'fastify';
import type { DiagramVersion } from './models/version.js';
import { versionNotFound } from './routes.js';
import { canSeeVersion, diagramsService } from './service.js';

/** Las imágenes de una versión no cambian nunca: una versión nueva tiene otra URL. */
const CACHE_CONTROL = 'private, max-age=31536000, immutable';

/** `If-None-Match` puede traer varios ETag, débiles o `*`. */
function matches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === '*' || tag === etag);
}

/**
 * GET /diagram-versions/:id/image/{display|thumb} (plan ajuste 1): `api` sirve la imagen desde
 * el bucket en streaming, con la membresía comprobada y caché privada del navegador.
 */
export async function imageRoutes(app: FastifyInstance) {
  const diagrams = diagramsService(app);

  for (const variant of ['display', 'thumb'] as const) {
    app.get(
      `/diagram-versions/:id/image/${variant}`,
      { preHandler: [app.requireAuth, app.requireResourceProject(diagrams.loadVersion)] },
      async (request, reply) => {
        const version = request.resource as DiagramVersion;
        if (!canSeeVersion(request.membership!, version)) throw versionNotFound();
        const object = await app.storage.getStream(
          variant === 'display' ? version.image.displayKey : version.image.thumbKey,
        );
        if (!object) throw versionNotFound();

        reply.header('cache-control', CACHE_CONTROL).header('etag', object.etag);
        if (matches(request.headers['if-none-match'], object.etag)) {
          object.body.destroy();
          return reply.code(304).send();
        }
        return reply
          .type('image/webp')
          .header('content-length', object.contentLength)
          .send(object.body);
      },
    );
  }
}
