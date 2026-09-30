import type { FastifyInstance } from 'fastify';
import { activitiesModel } from './models/activity.js';
import { diagramsModel } from './models/diagram.js';
import { versionsModel } from './models/version.js';
import { projectPrefix } from './service.js';

/**
 * Borrado en cascada de los diagramas de un proyecto (plan ajuste 6). Idempotente: el job de
 * la 002 lo repite si algo falla después.
 */
export function registerDiagramsCascade(app: FastifyInstance): void {
  app.registerProjectCascade('diagrams', async (projectId) => {
    await app.storage.deletePrefix(projectPrefix(projectId));
    await activitiesModel(app.mongo).deleteMany({ projectId });
    await versionsModel(app.mongo).deleteMany({ projectId });
    await diagramsModel(app.mongo).deleteMany({ projectId });
  });
}
