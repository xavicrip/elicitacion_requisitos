import type { FastifyInstance } from 'fastify';
import { analysisRunsModel } from './models/analysis-run.js';
import { analysisSettingsModel } from './models/analysis-settings.js';
import { duplicateDecisionsModel } from './models/duplicate-decision.js';
import { insightFeedbackModel } from './models/insight-feedback.js';

/**
 * Borrar un proyecto borra sus análisis, decisiones de duplicados, valoraciones y ajustes
 * (idempotente: el job de borrado lo repite si algo falla después). Los archivos de entrada y
 * de resultados viven bajo `projects/{id}/` en el bucket y los borra la cascada de la 003.
 */
export function registerDashboardCascade(app: FastifyInstance): void {
  app.registerProjectCascade('dashboard', async (projectId) => {
    await analysisRunsModel(app.mongo).deleteMany({ projectId });
    await duplicateDecisionsModel(app.mongo).deleteMany({ projectId });
    await insightFeedbackModel(app.mongo).deleteMany({ projectId });
    await analysisSettingsModel(app.mongo).deleteMany({ projectId });
  });
}
