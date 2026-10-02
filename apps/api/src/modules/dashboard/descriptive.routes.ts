import { DashboardFiltersSchema, DescriptiveDashboardSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { descriptiveService } from './descriptive.service.js';

const list = z.preprocess(
  (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
  z.array(z.string()).optional(),
);

/** Filtros por query (`?diagramId=…&type=…&status=…&from=…&to=…`), repetibles. */
export const FiltersQuery = z
  .object({
    diagramId: list,
    type: list,
    status: list,
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .transform((query, context) => {
    const parsed = DashboardFiltersSchema.safeParse({
      diagramIds: query.diagramId,
      types: query.type,
      from: query.from,
      to: query.to,
      ...(query.status ? { statuses: query.status } : {}),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) context.addIssue({ ...issue, code: 'custom' });
      return z.NEVER;
    }
    return parsed.data;
  });

/** GET /projects/:projectId/dashboard/descriptive (US1): solo Administradores, con filtros. */
export async function descriptiveRoutes(app: FastifyInstance) {
  const descriptive = descriptiveService(app);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.get(
    '/projects/:projectId/dashboard/descriptive',
    {
      preHandler: [app.requireAuth, app.requireProjectRole('admin')],
      schema: {
        params: z.object({ projectId: z.string() }),
        querystring: FiltersQuery,
        response: { 200: DescriptiveDashboardSchema },
      },
    },
    async (request) =>
      descriptive.compute(new Types.ObjectId(request.params.projectId), request.query),
  );
}
