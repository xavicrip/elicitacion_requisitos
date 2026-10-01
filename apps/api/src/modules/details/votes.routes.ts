import { VoteStateSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { USER_WRITE_RATE_LIMIT } from '../../plugins/rate-limit.js';
import { interactionsService } from './interactions.js';
import type { Detail } from './models/detail.js';
import { detailsService, type Viewer } from './service.js';

const IdParams = z.object({ id: z.string() });

/** PUT/DELETE /details/:id/vote (FR-008): idempotentes, solo con el proyecto abierto. */
export async function voteRoutes(app: FastifyInstance) {
  const { loadDetail } = detailsService(app);
  const interactions = interactionsService(app);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const options = {
    preHandler: [
      app.requireAuth,
      app.requireResourceProject(loadDetail),
      app.requireProjectStatus('open'),
    ],
    config: { rateLimit: USER_WRITE_RATE_LIMIT },
    schema: { params: IdParams, response: { 200: VoteStateSchema } },
  };
  const viewer = (request: { project?: unknown; membership?: unknown }) =>
    ({ project: request.project, membership: request.membership }) as Viewer;

  routes.put('/details/:id/vote', options, async (request) =>
    interactions.vote(request.resource as Detail, viewer(request)),
  );
  routes.delete('/details/:id/vote', options, async (request) =>
    interactions.unvote(request.resource as Detail, viewer(request)),
  );
}
