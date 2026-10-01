import type { FastifyInstance } from 'fastify';
import { commentsModel } from './models/comment.js';
import { detailsModel } from './models/detail.js';
import { historyModel } from './models/history.js';
import { votesModel } from './models/vote.js';

/**
 * Integración con la 002 y la 003 (plan de la 004, ajustes 4 y 5):
 * - Borrar un proyecto borra sus detalles, votos, comentarios e historial (idempotente: el job
 *   de borrado lo repite si algo falla después).
 * - Borrar una actividad con detalles pide confirmación con el conteo, pero los detalles **no**
 *   se borran: al publicar la versión sin esa actividad quedan huérfanos y el Administrador los
 *   reasigna (edge case de la spec).
 */
export function registerDetailsCascade(app: FastifyInstance): void {
  app.registerProjectCascade('details', async (projectId) => {
    await votesModel(app.mongo).deleteMany({ projectId });
    await commentsModel(app.mongo).deleteMany({ projectId });
    await historyModel(app.mongo).deleteMany({ projectId });
    await detailsModel(app.mongo).deleteMany({ projectId });
  });

  app.registerActivityDependents('details', {
    count: ({ projectId, key }) =>
      detailsModel(app.mongo).countDocuments({ projectId, activityKey: key }),
    remove: async () => {},
  });
}
