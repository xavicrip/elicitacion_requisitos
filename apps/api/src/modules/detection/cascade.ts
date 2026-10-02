import type { FastifyInstance } from 'fastify';
import { activityProposalsModel } from './models/activity-proposal.js';
import { detectionJobsModel } from './models/job.js';
import { transitionProposalsModel } from './models/transition-proposal.js';

/**
 * Borrar un proyecto borra sus detecciones y propuestas (idempotente: el job de borrado lo
 * repite si algo falla después). Las actividades ya aceptadas son de la 003 y las borra su
 * cascada.
 */
export function registerDetectionCascade(app: FastifyInstance): void {
  app.registerProjectCascade('detection', async (projectId) => {
    await transitionProposalsModel(app.mongo).deleteMany({ projectId });
    await activityProposalsModel(app.mongo).deleteMany({ projectId });
    await detectionJobsModel(app.mongo).deleteMany({ projectId });
  });
}
