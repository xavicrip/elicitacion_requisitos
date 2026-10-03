import type {
  DashboardFilters,
  Export,
  ExportFormat,
  ExportMode,
  ExportOptions,
  ExportStatus,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { HttpError } from '../../lib/errors.js';
import { auditService } from '../audit/service.js';
import { exportsModel, type ExportDoc } from './models/export.js';

/** Exportaciones que muestra el historial de un proyecto. */
const HISTORY_LIMIT = 50;
/** Los archivos generados en segundo plano se pueden descargar durante 24 h (FR-007). */
export const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

export type NewExport = {
  format: ExportFormat;
  filters: DashboardFilters;
  options: ExportOptions;
  mode: ExportMode;
  status: ExportStatus;
  detailCount: number;
  fileName: string;
  requestedBy: string;
  analysisRunId?: Types.ObjectId | null;
};

const isDuplicateKey = (error: unknown) => (error as { code?: number }).code === 11000;

/** Exportaciones de un proyecto (feature 008): registro, historial y auditoría (FR-008). */
export function exportsService(app: FastifyInstance) {
  const Exports = exportsModel(app.mongo);
  const audit = auditService(app.mongo, app.log);

  return {
    /** La exportación tal como la ve la web; `expired` se calcula al leer. */
    toDto(doc: ExportDoc, now = new Date()): Export {
      return {
        id: doc._id.toHexString(),
        projectId: doc.projectId.toHexString(),
        format: doc.format,
        mode: doc.mode,
        status: doc.status,
        expired: doc.expiresAt !== null && doc.expiresAt.getTime() <= now.getTime(),
        detailCount: doc.detailCount,
        fileName: doc.fileName,
        bytes: doc.bytes,
        error: doc.error ? { code: doc.error.code, message: doc.error.message } : null,
        createdAt: doc.createdAt.toISOString(),
        finishedAt: doc.finishedAt?.toISOString() ?? null,
        expiresAt: doc.expiresAt?.toISOString() ?? null,
      };
    },

    /** Historial del proyecto, de la más reciente a la más antigua. */
    list(projectId: Types.ObjectId): Promise<ExportDoc[]> {
      return Exports.find({ projectId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(HISTORY_LIMIT)
        .lean<ExportDoc[]>();
    },

    /**
     * Registra la solicitud y la audita. Como máximo una exportación en curso por proyecto y
     * formato (índice único parcial): la segunda responde 409.
     */
    async create(projectId: Types.ObjectId, input: NewExport): Promise<ExportDoc> {
      const now = new Date();
      let created;
      try {
        created = await Exports.create({
          projectId,
          format: input.format,
          filters: input.filters,
          options: input.options,
          mode: input.mode,
          status: input.status,
          detailCount: input.detailCount,
          fileName: input.fileName,
          analysisRunId: input.analysisRunId ?? null,
          requestedBy: new Types.ObjectId(input.requestedBy),
          finishedAt: input.status === 'done' ? now : null,
        });
      } catch (error) {
        if (isDuplicateKey(error)) {
          throw new HttpError(
            409,
            'EXPORT_IN_PROGRESS',
            'Ya hay una exportación de este formato en preparación.',
          );
        }
        throw error;
      }
      await audit.record('export.requested', {
        actorId: new Types.ObjectId(input.requestedBy),
        projectId,
        entity: { type: 'export', id: created._id.toHexString() },
        diff: {
          format: input.format,
          filters: input.filters,
          options: input.options,
          count: input.detailCount,
        },
      });
      return created.toObject<ExportDoc>();
    },
  };
}
