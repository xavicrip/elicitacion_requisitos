import {
  DetailInputSchema,
  DetailPatchSchema,
  HistoryEntrySchema,
  PrioritySchema,
  DetailSchema,
  DetailStatusSchema,
  DetailTypeSchema,
  FacetsSchema,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { parseIfMatch, revEtag } from '../../lib/if-match.js';
import { USER_WRITE_RATE_LIMIT } from '../../plugins/rate-limit.js';
import type { Diagram } from '../diagrams/models/diagram.js';
import { diagramsService } from '../diagrams/service.js';
import type { Detail } from './models/detail.js';
import { DetailConflict, detailsService } from './service.js';

const ActivityParams = z.object({ id: z.string(), key: z.string() });
const ProjectParams = z.object({ projectId: z.string() });
const IdParams = z.object({ id: z.string() });
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

  const writable = [
    app.requireAuth,
    app.requireResourceProject(details.loadDetail),
    app.requireProjectStatus('open'),
  ];

  routes.patch(
    '/details/:id',
    {
      preHandler: writable,
      config: { rateLimit: USER_WRITE_RATE_LIMIT },
      // 409: el detalle actual (conflicto de edición) o el error PROJECT_NOT_OPEN.
      schema: {
        params: IdParams,
        body: DetailPatchSchema,
        response: { 200: DetailSchema, 409: z.unknown() },
      },
    },
    async (request, reply) => {
      const rev = parseIfMatch(request.headers['if-match'], 'el requisito');
      try {
        const detail = await details.update(
          request.resource as Detail,
          rev,
          request.body,
          viewer(request),
        );
        return reply.header('etag', revEtag(detail.rev)).send(detail);
      } catch (error) {
        if (!(error instanceof DetailConflict)) throw error;
        return reply.code(409).header('etag', revEtag(error.current.rev)).send(error.current);
      }
    },
  );

  routes.delete(
    '/details/:id',
    {
      preHandler: writable,
      config: { rateLimit: USER_WRITE_RATE_LIMIT },
      schema: { params: IdParams },
    },
    async (request, reply) => {
      await details.remove(request.resource as Detail, viewer(request));
      return reply.code(204).send();
    },
  );

  routes.get(
    '/details/:id/history',
    {
      preHandler: [app.requireAuth, app.requireResourceProject(details.loadDetail)],
      schema: { params: IdParams, response: { 200: z.array(HistoryEntrySchema) } },
    },
    async (request) => details.history(request.resource as Detail),
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
