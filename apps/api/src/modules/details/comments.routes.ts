import { CommentInputSchema, CommentSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { USER_WRITE_RATE_LIMIT } from '../../plugins/rate-limit.js';
import { interactionsService } from './interactions.js';
import type { DetailComment } from './models/comment.js';
import type { Detail } from './models/detail.js';
import { detailsService, type Viewer } from './service.js';

const IdParams = z.object({ id: z.string() });

/** Comentarios de los detalles (FR-009); escribir exige el proyecto abierto (FR-013). */
export async function commentRoutes(app: FastifyInstance) {
  const { loadDetail } = detailsService(app);
  const interactions = interactionsService(app);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const viewer = (request: { project?: unknown; membership?: unknown }) =>
    ({ project: request.project, membership: request.membership }) as Viewer;
  const write = (loader: Parameters<typeof app.requireResourceProject>[0]) => ({
    preHandler: [
      app.requireAuth,
      app.requireResourceProject(loader),
      app.requireProjectStatus('open'),
    ],
    config: { rateLimit: USER_WRITE_RATE_LIMIT },
  });

  routes.get(
    '/details/:id/comments',
    {
      preHandler: [app.requireAuth, app.requireResourceProject(loadDetail)],
      schema: { params: IdParams, response: { 200: z.array(CommentSchema) } },
    },
    async (request) => interactions.listComments(request.resource as Detail, viewer(request)),
  );

  routes.post(
    '/details/:id/comments',
    {
      ...write(loadDetail),
      schema: { params: IdParams, body: CommentInputSchema, response: { 201: CommentSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return interactions.comment(request.resource as Detail, request.body.text, viewer(request));
    },
  );

  routes.patch(
    '/comments/:id',
    {
      ...write(interactions.loadComment),
      schema: { params: IdParams, body: CommentInputSchema, response: { 200: CommentSchema } },
    },
    async (request) =>
      interactions.editComment(
        request.resource as DetailComment,
        request.body.text,
        viewer(request),
      ),
  );

  routes.delete(
    '/comments/:id',
    { ...write(interactions.loadComment), schema: { params: IdParams } },
    async (request, reply) => {
      await interactions.removeComment(request.resource as DetailComment, viewer(request));
      return reply.code(204).send();
    },
  );
}
