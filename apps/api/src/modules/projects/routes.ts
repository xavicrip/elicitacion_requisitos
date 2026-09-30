import {
  ProjectInputSchema,
  ProjectSchema,
  ProjectSummarySchema,
  StatusActionSchema,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { projectsService, toProjectDto } from './service.js';

const Params = z.object({ projectId: z.string() });

/**
 * Rutas de proyectos (contracts/auth-projects.openapi.yaml, contracts/authorization-matrix.md).
 * `requireProjectRole` deja en la petición el proyecto y la membresía del usuario.
 */
export async function projectRoutes(app: FastifyInstance) {
  const projects = projectsService(app);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const member = [app.requireAuth, app.requireProjectRole('member')];
  const admin = [app.requireAuth, app.requireProjectRole('admin')];

  routes.get(
    '/projects',
    { preHandler: app.requireAuth, schema: { response: { 200: z.array(ProjectSummarySchema) } } },
    async (request) => projects.list(request.user.id),
  );

  routes.post(
    '/projects',
    {
      preHandler: app.requireAuth,
      schema: { body: ProjectInputSchema, response: { 201: ProjectSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return projects.create(request.user.id, request.body);
    },
  );

  routes.get(
    '/projects/:projectId',
    { preHandler: member, schema: { params: Params, response: { 200: ProjectSchema } } },
    async (request) => toProjectDto(request.project!, request.membership!),
  );

  routes.patch(
    '/projects/:projectId',
    {
      preHandler: admin,
      schema: { params: Params, body: ProjectInputSchema, response: { 200: ProjectSchema } },
    },
    async (request) =>
      projects.update(request.project!, request.membership!, request.body, request.user.id),
  );

  routes.post(
    '/projects/:projectId/status',
    {
      preHandler: admin,
      schema: {
        params: Params,
        body: z.object({ action: StatusActionSchema }),
        response: { 200: ProjectSchema },
      },
    },
    async (request) =>
      projects.changeStatus(
        request.project!,
        request.membership!,
        request.body.action,
        request.user.id,
      ),
  );
}
