import { ActivityInputSchema, ActivityPatchSchema, ActivitySchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activitiesService, activityEtag, RevConflict } from './activities.service.js';
import { parseIfMatch } from '../../lib/if-match.js';
import { toActivityDto } from './dto.js';
import type { Activity } from './models/activity.js';
import type { DiagramVersion } from './models/version.js';
import { diagramsService } from './service.js';

const IdParams = z.object({ id: z.string() });
const WRITABLE = ['draft', 'open'] as const;

/** Editor de actividades (US2): solo el Administrador, en versiones en borrador. */
export async function activityRoutes(app: FastifyInstance) {
  const activities = activitiesService(app);
  const { loadVersion } = diagramsService(app);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const writable = (loader: Parameters<typeof app.requireResourceProject>[0]) => [
    app.requireAuth,
    app.requireResourceProject(loader, 'admin'),
    app.requireProjectStatus([...WRITABLE]),
  ];

  routes.post(
    '/diagram-versions/:id/activities',
    {
      preHandler: writable(loadVersion),
      schema: { params: IdParams, body: ActivityInputSchema, response: { 201: ActivitySchema } },
    },
    async (request, reply) => {
      const activity = await activities.create(request.resource as DiagramVersion, request.body, {
        actorId: request.user.id,
      });
      return reply.code(201).header('etag', activityEtag(activity.rev)).send(activity);
    },
  );

  routes.patch(
    '/activities/:id',
    {
      preHandler: writable(activities.loadActivity),
      schema: {
        params: IdParams,
        body: ActivityPatchSchema,
        response: { 200: ActivitySchema, 409: z.unknown() },
      },
    },
    async (request, reply) => {
      const rev = parseIfMatch(request.headers['if-match'], 'la actividad');
      try {
        const activity = await activities.update(request.resource as Activity, rev, request.body, {
          actorId: request.user.id,
        });
        return reply.header('etag', activityEtag(activity.rev)).send(activity);
      } catch (error) {
        if (!(error instanceof RevConflict)) throw error;
        return reply
          .code(409)
          .header('etag', activityEtag(error.current.rev))
          .send(toActivityDto(error.current));
      }
    },
  );

  routes.delete(
    '/activities/:id',
    {
      preHandler: writable(activities.loadActivity),
      schema: { params: IdParams, querystring: z.object({ confirm: z.stringbool().optional() }) },
    },
    async (request, reply) => {
      await activities.remove(request.resource as Activity, request.query.confirm ?? false, {
        actorId: request.user.id,
      });
      return reply.code(204).send();
    },
  );
}
