import { ActivityCoverageSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { DiagramVersion } from '../diagrams/models/version.js';
import { versionNotFound } from '../diagrams/routes.js';
import { canSeeVersion, diagramsService } from '../diagrams/service.js';
import { coverageOf } from './coverage.js';

/**
 * GET /diagram-versions/:id/coverage (research R7): indicadores del canvas. Misma visibilidad
 * que la versión (003): un Participante solo consulta versiones publicadas.
 */
export async function coverageRoutes(app: FastifyInstance) {
  const { loadVersion } = diagramsService(app);
  app.withTypeProvider<ZodTypeProvider>().get(
    '/diagram-versions/:id/coverage',
    {
      preHandler: [app.requireAuth, app.requireResourceProject(loadVersion)],
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.array(ActivityCoverageSchema) },
      },
    },
    async (request) => {
      const version = request.resource as DiagramVersion;
      if (!canSeeVersion(request.membership!, version)) throw versionNotFound();
      return coverageOf(app, version);
    },
  );
}
