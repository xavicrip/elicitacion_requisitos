import {
  InvitationCreatedSchema,
  InvitationPreviewSchema,
  InvitationSchema,
  ProjectSummarySchema,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { invitationsService } from './service.js';

const Params = z.object({ projectId: z.string() });
const TokenParams = z.object({ token: z.string() });

/** Rutas de invitaciones (contracts/auth-projects.openapi.yaml, authorization-matrix.md). */
export async function invitationRoutes(
  app: FastifyInstance,
  { appBaseUrl }: { appBaseUrl: string },
) {
  const invitations = invitationsService(app, appBaseUrl);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const admin = [app.requireAuth, app.requireProjectRole('admin')];

  routes.get(
    '/projects/:projectId/invitations',
    { preHandler: admin, schema: { params: Params, response: { 200: z.array(InvitationSchema) } } },
    async (request) => invitations.list(request.project!),
  );

  routes.post(
    '/projects/:projectId/invitations',
    { preHandler: admin, schema: { params: Params, response: { 201: InvitationCreatedSchema } } },
    async (request, reply) => {
      reply.code(201);
      return invitations.create(request.project!, request.user.id);
    },
  );

  routes.delete(
    '/projects/:projectId/invitations/:invitationId',
    { preHandler: admin, schema: { params: Params.extend({ invitationId: z.string() }) } },
    async (request, reply) => {
      await invitations.revoke(request.project!, request.params.invitationId, request.user.id);
      return reply.code(204).send();
    },
  );

  // Pública: la persona invitada ve el nombre del proyecto antes de registrarse o entrar.
  routes.get(
    '/invitations/:token',
    { schema: { params: TokenParams, response: { 200: InvitationPreviewSchema } } },
    async (request) => invitations.preview(request.params.token),
  );

  routes.post(
    '/invitations/:token/accept',
    {
      preHandler: app.requireAuth,
      schema: { params: TokenParams, response: { 200: ProjectSummarySchema } },
    },
    async (request) => invitations.accept(request.params.token, request.user.id),
  );
}
