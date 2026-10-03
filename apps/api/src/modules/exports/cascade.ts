import type { FastifyInstance } from 'fastify';
import { exportsModel } from './models/export.js';

/**
 * Borrar un proyecto borra sus exportaciones (idempotente: el job de borrado lo repite si algo
 * falla después). Los archivos viven bajo `projects/{id}/` en el bucket y los borra la cascada
 * de la 003.
 */
export function registerExportsCascade(app: FastifyInstance): void {
  app.registerProjectCascade('exports', async (projectId) => {
    await exportsModel(app.mongo).deleteMany({ projectId });
  });
}
