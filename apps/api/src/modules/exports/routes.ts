import {
  DashboardFiltersSchema,
  ExportOptionsSchema,
  ExportRequestSchema,
  ExportSchema,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Types } from 'mongoose';
import { z } from 'zod';
import type { ExportFilesConfig } from '../../jobs/export-files.js';
import { HttpError } from '../../lib/errors.js';
import { projectsModel } from '../projects/model.js';
import { auditService } from '../audit/service.js';
import { exportsModel, type ExportDoc } from './models/export.js';
import { exportQuery } from './query.js';
import { CONTENT_TYPE, isFileFormat, renderExport } from './render.js';
import { exportFileName } from './sanitize.js';
import { exportsService } from './service.js';

export type ExportsConfig = ExportFilesConfig & {
  /** Hasta este número de detalles la exportación se responde en streaming (1 000). */
  syncLimit?: number;
};

const ProjectParams = z.object({ projectId: z.string() });
const IdParams = z.object({ id: z.string() });

/**
 * Exportaciones (feature 008; contracts/exports.openapi.yaml): solicitar, historial, estado y
 * descarga. Solo Administradores del proyecto.
 */
export async function exportRoutes(app: FastifyInstance, config: ExportsConfig = {}) {
  const syncLimit = config.syncLimit ?? 1000;
  const exportsOf = exportsService(app);
  const audit = auditService(app.mongo, app.log);
  const query = exportQuery(app);
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
    async (request, reply) => {
      const projectId = new Types.ObjectId(request.params.projectId);
      const { format } = request.body;
      const filters = request.body.filters ?? DashboardFiltersSchema.parse({});
      const options = request.body.options ?? ExportOptionsSchema.parse({});
      const count = await query.count(projectId, filters);
      if (!isFileFormat(format)) {
        // Respuesta temporal, fuera del contrato: cada historia de la 008 añade su formato.
        throw new HttpError(501, 'FORMAT_NOT_AVAILABLE', 'Este formato aún no está disponible.');
      }

      const project = await projectsModel(app.mongo)
        .findById(projectId, { name: 1 })
        .lean<{ name: string }>();
      const timeZone = await query.timeZone(projectId);
      const fileName = exportFileName(project?.name ?? '', format, new Date(), timeZone);
      const base = {
        format,
        filters,
        options,
        detailCount: count,
        fileName,
        requestedBy: request.user.id,
      };
      if (count > syncLimit) {
        // En segundo plano (FR-006): la web consulta el estado y descarga cuando esté lista.
        const pending = await exportsOf.create(projectId, {
          ...base,
          mode: 'async',
          status: 'pending',
        });
        await app.exportFiles.enqueue(pending);
        reply.code(202);
        return exportsOf.toDto(pending);
      }

      // Síncrona: el archivo se entrega en la respuesta y no se guarda (plan, ajuste 8).
      const created = await exportsOf.create(projectId, { ...base, mode: 'sync', status: 'done' });
      const body = renderExport(format, query.rows(projectId, filters), options, timeZone);
      reply
        .header('content-type', CONTENT_TYPE[format])
        .header('content-disposition', `attachment; filename="${fileName}"`)
        .header('x-export-id', created._id.toHexString());
      if (count === 0) reply.header('x-export-empty', 'true');
      return reply.send(body);
    },
  );

  routes.get(
    '/exports/:id',
    { preHandler: onExport, schema: { params: IdParams, response: { 200: ExportSchema } } },
    async (request) => exportsOf.toDto(request.resource as ExportDoc),
  );

  routes.get(
    '/exports/:id/download',
    { preHandler: onExport, schema: { params: IdParams } },
    async (request, reply) => {
      const exported = request.resource as ExportDoc;
      if (exported.status === 'pending' || exported.status === 'running') {
        throw new HttpError(409, 'EXPORT_NOT_READY', 'La exportación aún no está lista.');
      }
      const expired = exported.expiresAt !== null && exported.expiresAt.getTime() <= Date.now();
      const object =
        exported.status === 'done' && exported.fileKey && !expired
          ? await app.storage.getStream(exported.fileKey)
          : null;
      if (!object) {
        throw new HttpError(410, 'EXPORT_EXPIRED', 'El enlace caducó. Vuelve a exportar.');
      }
      await audit.record('export.downloaded', {
        actorId: new Types.ObjectId(request.user.id),
        projectId: exported.projectId,
        entity: { type: 'export', id: exported._id.toHexString() },
        diff: { format: exported.format },
      });
      return reply
        .header('content-type', CONTENT_TYPE[exported.format])
        .header('content-disposition', `attachment; filename="${exported.fileName ?? 'export'}"`)
        .header('content-length', object.contentLength)
        .header('cache-control', 'private, no-store')
        .send(object.body);
    },
  );
}
