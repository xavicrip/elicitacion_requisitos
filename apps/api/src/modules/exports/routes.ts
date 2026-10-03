import { PassThrough, type Readable } from 'node:stream';
import {
  DashboardFiltersSchema,
  ExportOptionsSchema,
  ExportRequestSchema,
  ExportSchema,
  type ExportFormat,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Types } from 'mongoose';
import { z } from 'zod';
import { HttpError } from '../../lib/errors.js';
import { projectsModel } from '../projects/model.js';
import { csvStream } from './csv.js';
import { exportsModel, type ExportDoc } from './models/export.js';
import { exportQuery } from './query.js';
import { exportFileName } from './sanitize.js';
import { exportsService } from './service.js';
import { writeXlsx } from './xlsx.js';

export type ExportsConfig = {
  /** Hasta este número de detalles la exportación se responde en streaming (1 000). */
  syncLimit?: number;
};

const ProjectParams = z.object({ projectId: z.string() });
const IdParams = z.object({ id: z.string() });

const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  gherkin: 'application/zip',
  pdf: 'application/pdf',
};

/**
 * Exportaciones (feature 008; contracts/exports.openapi.yaml): solicitar, historial, estado y
 * descarga. Solo Administradores del proyecto.
 */
export async function exportRoutes(app: FastifyInstance, config: ExportsConfig = {}) {
  const syncLimit = config.syncLimit ?? 1000;
  const exportsOf = exportsService(app);
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
      if ((format !== 'csv' && format !== 'xlsx') || count > syncLimit) {
        // Respuesta temporal, fuera del contrato: cada historia de la 008 añade su parte.
        throw new HttpError(501, 'FORMAT_NOT_AVAILABLE', 'Este formato aún no está disponible.');
      }

      const project = await projectsModel(app.mongo)
        .findById(projectId, { name: 1 })
        .lean<{ name: string }>();
      const timeZone = await query.timeZone(projectId);
      const fileName = exportFileName(project?.name ?? '', format, new Date(), timeZone);
      // Síncrona: el archivo se entrega en la respuesta y no se guarda (plan, ajuste 8).
      const created = await exportsOf.create(projectId, {
        format,
        filters,
        options,
        mode: 'sync',
        status: 'done',
        detailCount: count,
        fileName,
        requestedBy: request.user.id,
      });

      const rows = query.rows(projectId, filters);
      let body: Readable;
      if (format === 'csv') {
        body = csvStream(rows, options.delimiter);
      } else {
        const output = new PassThrough();
        writeXlsx(rows, output, timeZone).catch((error: Error) => output.destroy(error));
        body = output;
      }
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
}
