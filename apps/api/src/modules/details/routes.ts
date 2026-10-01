import {
  DetailInputSchema,
  PrioritySchema,
  DetailSchema,
  DetailStatusSchema,
  DetailTypeSchema,
  FacetsSchema,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { revEtag } from '../../lib/if-match.js';
import { USER_WRITE_RATE_LIMIT } from '../../plugins/rate-limit.js';
import type { Diagram } from '../diagrams/models/diagram.js';
import { diagramsService } from '../diagrams/service.js';
import { detailsService } from './service.js';

const ActivityParams = z.object({ id: z.string(), key: z.string() });
const ProjectParams = z.object({ projectId: z.string() });
const ListQuerySchema = z.object({
  status: DetailStatusSchema.optional(),
  type: DetailTypeSchema.optional(),
  priority: PrioritySchema.optional(),
  tag: z.string().max(30).optional(),
  sort: z.enum(['votes', 'recent']).default('votes'),
});

/**
 * Detalles de requisitos de una actividad (contracts/details.openapi.yaml). Las rutas por
 * diagrama usan `:id` para `requireResourceProject` (plan, ajuste 3).
 */
export async function detailRoutes(app: FastifyInstance) {
  const details = detailsService(app);
  const { loadDiagram } = diagramsService(app);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const viewer = (request: { project?: unknown; membership?: unknown }) =>
    ({ project: request.project, membership: request.membership }) as Parameters<
      typeof details.list
    >[3];

  routes.get(
    '/diagrams/:id/activities/:key/details',
    {
      preHandler: [app.requireAuth, app.requireResourceProject(loadDiagram)],
      schema: {
        params: ActivityParams,
        querystring: ListQuerySchema,
        response: { 200: z.array(DetailSchema) },
      },
    },
    async (request) =>
      details.list(request.resource as Diagram, request.params.key, request.query, viewer(request)),
  );

  routes.post(
    '/diagrams/:id/activities/:key/details',
    {
      preHandler: [
        app.requireAuth,
        app.requireResourceProject(loadDiagram),
        app.requireProjectStatus('open'),
      ],
      config: { rateLimit: USER_WRITE_RATE_LIMIT },
      schema: { params: ActivityParams, body: DetailInputSchema, response: { 201: DetailSchema } },
    },
    async (request, reply) => {
      const detail = await details.create(
        request.resource as Diagram,
        request.params.key,
        request.body,
        viewer(request),
      );
      return reply.code(201).header('etag', revEtag(detail.rev)).send(detail);
    },
  );

  routes.get(
    '/projects/:projectId/details/facets',
    {
      preHandler: [app.requireAuth, app.requireProjectRole('member')],
      schema: { params: ProjectParams, response: { 200: FacetsSchema } },
    },
    async (request) => details.facets(request.project!._id),
  );
}
