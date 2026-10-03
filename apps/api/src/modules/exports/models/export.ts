import type {
  DashboardFilters,
  ExportFormat,
  ExportMode,
  ExportOptions,
  ExportStatus,
} from '@reqcanvas/shared';
import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../../lib/model.js';

/**
 * Exportación solicitada por un Administrador (data-model.md); `_id` es el `jobId` de BullMQ si
 * es asíncrona. Solo la escribe `api`: el worker del PDF devuelve un resumen (plan, ajuste 1).
 */
export type ExportDoc = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  format: ExportFormat;
  options: ExportOptions;
  filters: DashboardFilters;
  mode: ExportMode;
  /** Estados de la constitución VI; la caducidad es `expiresAt`, no un estado. */
  status: ExportStatus;
  detailCount: number;
  /** Solo en PDF: el último análisis terminado, si lo había. */
  analysisRunId: Types.ObjectId | null;
  /** Clave en el bucket; `null` en las síncronas y tras la limpieza de las caducadas. */
  fileKey: string | null;
  fileName: string | null;
  bytes: number | null;
  /** Mensaje en español, sin detalles internos. */
  error: { code: string; message: string } | null;
  requestedBy: Types.ObjectId;
  finishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const ExportSchema = new Schema<ExportDoc>(
  {
    projectId: { type: Schema.Types.ObjectId, required: true },
    format: { type: String, enum: ['csv', 'xlsx', 'gherkin', 'pdf'], required: true },
    options: { type: Schema.Types.Mixed, required: true },
    filters: { type: Schema.Types.Mixed, required: true },
    mode: { type: String, enum: ['sync', 'async'], required: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'done', 'failed'],
      required: true,
      default: 'pending',
    },
    detailCount: { type: Number, required: true, min: 0 },
    analysisRunId: { type: Schema.Types.ObjectId, default: null },
    fileKey: { type: String, default: null },
    fileName: { type: String, default: null },
    bytes: { type: Number, default: null, min: 0 },
    error: { type: { code: String, message: String }, default: null, _id: false },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    finishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { ...SCHEMA_OPTIONS, minimize: false },
);

export const exportsModel = (connection: Connection) =>
  modelFor(connection, 'Export', ExportSchema, 'exports');
