import { AnalysisRunSchema, DashboardFiltersSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Types } from 'mongoose';
import { z } from 'zod';
import { HttpError } from '../../lib/errors.js';
import { analysisService } from './analysis.service.js';
import { analysisRunsModel, type AnalysisRunDoc } from './models/analysis-run.js';

const ProjectParams = z.object({ projectId: z.string() });
const IdParams = z.object({ id: z.string() });
const CreateBody = z.preprocess(
  (body) => body ?? {},
  z.object({ filters: DashboardFiltersSchema.optional() }),
);

/**
 * Análisis del dashboard (US2; contracts/dashboard.openapi.yaml): lanzar, consultar el progreso y
 * leer los resultados. Solo Administradores. Los resultados se leen del bucket, no de MongoDB.
 */
export async function analysisRoutes(app: FastifyInstance) {
  const analysis = analysisService(app);
  const Runs = analysisRunsModel(app.mongo);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const admin = [app.requireAuth, app.requireProjectRole('admin')];
  const loadRun = (id: string) => Runs.findById(id).lean<AnalysisRunDoc>();

  routes.post(
    '/projects/:projectId/analysis-runs',
    {
      preHandler: admin,
      schema: { params: ProjectParams, body: CreateBody, response: { 202: AnalysisRunSchema } },
    },
    async (request, reply) => {
      const run = await analysis.create(new Types.ObjectId(request.params.projectId), {
        filters: request.body.filters ?? DashboardFiltersSchema.parse({}),
        trigger: 'manual',
        requestedBy: request.user.id,
      });
      reply.code(202);
      return analysis.toDto(run);
    },
  );

  routes.get(
    '/projects/:projectId/analysis-runs',
    {
      preHandler: admin,
      schema: { params: ProjectParams, response: { 200: z.array(AnalysisRunSchema) } },
    },
    async (request) => {
      const runs = await Runs.find({ projectId: new Types.ObjectId(request.params.projectId) })
        .sort({ createdAt: -1 })
        .lean<AnalysisRunDoc[]>();
      return Promise.all(runs.map((run) => analysis.toDto(run)));
    },
  );

  routes.get(
    '/projects/:projectId/analysis-runs/latest',
    { preHandler: admin, schema: { params: ProjectParams, response: { 200: AnalysisRunSchema } } },
    async (request) => {
      const run = await Runs.findOne({
        projectId: new Types.ObjectId(request.params.projectId),
        status: 'done',
        kind: 'full',
      })
        .sort({ createdAt: -1 })
        .lean<AnalysisRunDoc>();
      if (!run) throw new HttpError(404, 'NOT_FOUND', 'Todavía no hay ningún análisis.');
      return analysis.toFullDto(run);
    },
  );

  routes.get(
    '/analysis-runs/:id',
    {
      preHandler: [app.requireAuth, app.requireResourceProject(loadRun, 'admin')],
      schema: { params: IdParams, response: { 200: AnalysisRunSchema } },
    },
    async (request) => {
      const run = request.resource as AnalysisRunDoc;
      return analysis.toFullDto(run);
    },
  );
}
