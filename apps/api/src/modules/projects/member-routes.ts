import { MemberSchema, RoleChangeSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { membersService } from './members.js';

const Params = z.object({ projectId: z.string() });
const MemberParams = Params.extend({ userId: z.string() });

/** Rutas de miembros (contracts/auth-projects.openapi.yaml, authorization-matrix.md). */
export async function memberRoutes(app: FastifyInstance) {
  const members = membersService(app);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const member = [app.requireAuth, app.requireProjectRole('member')];
  const admin = [app.requireAuth, app.requireProjectRole('admin')];

  routes.get(
    '/projects/:projectId/members',
    { preHandler: member, schema: { params: Params, response: { 200: z.array(MemberSchema) } } },
    async (request) => members.list(request.project!),
  );

  routes.patch(
    '/projects/:projectId/members/:userId',
    {
      preHandler: admin,
      schema: { params: MemberParams, body: RoleChangeSchema, response: { 200: MemberSchema } },
    },
    async (request) =>
      members.changeRole(
        request.project!,
        request.params.userId,
        request.body.role,
        request.user.id,
      ),
  );

  // Cualquier miembro llega aquí: abandonar el proyecto es propio; retirar a otros, de Admin.
  routes.delete(
    '/projects/:projectId/members/:userId',
    { preHandler: member, schema: { params: MemberParams } },
    async (request, reply) => {
      await members.remove(
        request.project!,
        request.membership!,
        request.params.userId,
        request.user.id,
      );
      return reply.code(204).send();
    },
  );
}
