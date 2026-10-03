import {
  AnalysisSettingsInputSchema,
  AnalysisSettingsSchema,
  DuplicateDecisionInputSchema,
  DuplicateDecisionSchema,
  type AnalysisSettings,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { isValidObjectId, Types } from 'mongoose';
import { z } from 'zod';
import { HttpError } from '../../lib/errors.js';
import { detailsModel, type Detail } from '../details/models/detail.js';
import { detailsService, type Viewer } from '../details/service.js';
import { analysisSettingsModel, DEFAULT_SCHEDULE } from './models/analysis-settings.js';
import { duplicateDecisionsModel } from './models/duplicate-decision.js';

const ProjectParams = z.object({ projectId: z.string() });

const notInProject = () =>
  new HttpError(
    422,
    'DETAIL_NOT_FOUND',
    'Alguno de los dos detalles ya no existe en este proyecto.',
  );

/**
 * Decisiones del Administrador sobre el análisis (US3): confirmar o rechazar un par de posibles
 * duplicados y ajustar los términos del proyecto. Confirmar aplica la moderación de la 004; nada
 * cambia un detalle sin esta acción explícita (FR-015).
 */
export async function decisionRoutes(app: FastifyInstance) {
  const details = detailsService(app);
  const Details = detailsModel(app.mongo);
  const Decisions = duplicateDecisionsModel(app.mongo);
  const Settings = analysisSettingsModel(app.mongo);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const admin = [app.requireAuth, app.requireProjectRole('admin')];

  routes.post(
    '/projects/:projectId/duplicate-decisions',
    {
      preHandler: admin,
      schema: {
        params: ProjectParams,
        body: DuplicateDecisionInputSchema,
        response: { 201: DuplicateDecisionSchema },
      },
    },
    async (request, reply) => {
      const projectId = new Types.ObjectId(request.params.projectId);
      const { decision, keep, similarity } = request.body;
      const pair = [...request.body.pair].sort() as [string, string];
      if (!pair.every((id) => isValidObjectId(id))) throw notInProject();
      const both = await Details.find({ _id: { $in: pair }, projectId }).lean<Detail[]>();
      if (both.length !== 2) throw notInProject();
      if (decision === 'confirmed' && request.project!.status !== 'open') {
        throw new HttpError(
          409,
          'PROJECT_NOT_OPEN',
          'Solo se pueden marcar duplicados mientras el proyecto está abierto.',
        );
      }

      let created;
      try {
        created = await Decisions.create({
          projectId,
          pair,
          decision,
          similarity: similarity ?? null,
          decidedBy: new Types.ObjectId(request.user.id),
        });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        throw new HttpError(409, 'ALREADY_DECIDED', 'Este par ya se revisó.');
      }

      if (decision === 'confirmed') {
        const duplicate = both.find((detail) => detail._id.toHexString() !== keep)!;
        try {
          await details.moderate(duplicate, { status: 'duplicate', duplicateOf: keep! }, {
            project: request.project,
            membership: request.membership,
          } as Viewer);
        } catch (error) {
          // La moderación no se pudo aplicar: la decisión no queda registrada.
          await Decisions.deleteOne({ _id: created._id });
          throw error;
        }
      }
      reply.code(201);
      return {
        id: created._id.toHexString(),
        pair,
        decision,
        decidedAt: created.decidedAt.toISOString(),
      };
    },
  );

  const toDto = (settings: Partial<AnalysisSettings> | null): AnalysisSettings => ({
    extraAmbiguousTerms: settings?.extraAmbiguousTerms ?? [],
    extraStopwords: settings?.extraStopwords ?? [],
    schedule: {
      enabled: settings?.schedule?.enabled ?? DEFAULT_SCHEDULE.enabled,
      cron: settings?.schedule?.cron ?? DEFAULT_SCHEDULE.cron,
      timezone: settings?.schedule?.timezone ?? DEFAULT_SCHEDULE.timezone,
    },
  });

  routes.get(
    '/projects/:projectId/analysis-settings',
    {
      preHandler: admin,
      schema: { params: ProjectParams, response: { 200: AnalysisSettingsSchema } },
    },
    async (request) =>
      toDto(
        await Settings.findOne({
          projectId: new Types.ObjectId(request.params.projectId),
        }).lean<AnalysisSettings>(),
      ),
  );

  routes.put(
    '/projects/:projectId/analysis-settings',
    {
      preHandler: admin,
      schema: {
        params: ProjectParams,
        body: AnalysisSettingsInputSchema,
        response: { 200: AnalysisSettingsSchema },
      },
    },
    async (request) => {
      const saved = await Settings.findOneAndUpdate(
        { projectId: new Types.ObjectId(request.params.projectId) },
        { $set: request.body },
        { upsert: true, returnDocument: 'after' },
      ).lean<AnalysisSettings>();
      // La programación del proyecto sigue a sus ajustes (FR-013).
      await app.analysisSchedule.sync(new Types.ObjectId(request.params.projectId));
      return toDto(saved);
    },
  );
}
