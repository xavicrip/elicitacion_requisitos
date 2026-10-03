import { ExportRequestSchema, ExportSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Types } from 'mongoose';
import { z } from 'zod';
import { HttpError } from '../../lib/errors.js';
import { exportsModel, type ExportDoc } from './models/export.js';
import { exportsService } from './service.js';

const ProjectParams = z.object({ projectId: z.string() });
const IdParams = z.object({ id: z.string() });

/**
 * Exportaciones (feature 008; contracts/exports.openapi.yaml): solicitar, historial, estado y
 * descarga. Solo Administradores del proyecto.
 */
export async function exportRoutes(app: FastifyInstance) {
  const exportsOf = exportsService(app);
  const Exports = exportsModel(app.mongo);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const admin = [app.requireAuth, app.requireProjectRole('admin')];
  const loadExport = (id: string) => Exports.findById(id).lean<ExportDoc>();
  const onExport = [app.requireAuth, app.requireResourceProject(loadExport, 'admin')];

  routes.get(
    '/projects/:projectId/exports',
    {
      preHandler: admin,
      schema: { params: ProjectParams, response: { 200: z.array(ExportSchema) } },
    },
    async (request) => {
      const docs = await exportsOf.list(new Types.ObjectId(request.params.projectId));
      return docs.map((doc) => exportsOf.toDto(doc));
    },
  );

  routes.post(
    '/projects/:projectId/exports',
    { preHandler: admin, schema: { params: ProjectParams, body: ExportRequestSchema } },
    async () => {
      // Respuesta temporal, fuera del contrato: cada historia de la 008 añade su formato.
      throw new HttpError(501, 'FORMAT_NOT_AVAILABLE', 'Este formato aún no está disponible.');
    },
  );

  routes.get(
    '/exports/:id',
    { preHandler: onExport, schema: { params: IdParams, response: { 200: ExportSchema } } },
    async (request) => exportsOf.toDto(request.resource as ExportDoc),
  );
}
