import type {
  AnalysisProgress,
  AnalysisRunStatus,
  DashboardFilters,
  StageResult,
} from '@reqcanvas/shared';
import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../../lib/model.js';

/**
 * Ejecución del análisis de un proyecto (data-model.md); `_id` es el `jobId` de BullMQ. Solo la
 * escribe `api`: el worker devuelve el resumen y sube los resultados al bucket (plan, ajuste 1).
 */
export type AnalysisRunDoc = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  trigger: 'manual' | 'scheduled';
  kind: 'full' | 'insights';
  /** Run del que se regeneran los insights (`kind: insights`). */
  sourceRunId: Types.ObjectId | null;
  filters: DashboardFilters;
  /** Estados de la constitución VI; `partial` marca etapas fallidas. */
  status: AnalysisRunStatus;
  partial: boolean;
  progress: AnalysisProgress | null;
  stages: Partial<Record<string, StageResult>>;
  dataFingerprint: { count: number; maxUpdatedAt: Date | null };
  detailCount: number | null;
  inputKey: string;
  resultsKey: string;
  /** Mensaje en español, sin detalles internos. */
  error: { code: string; message: string } | null;
  requestedBy: Types.ObjectId | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const RunSchema = new Schema<AnalysisRunDoc>(
  {
    projectId: { type: Schema.Types.ObjectId, required: true },
    trigger: { type: String, enum: ['manual', 'scheduled'], required: true },
    kind: { type: String, enum: ['full', 'insights'], required: true, default: 'full' },
    sourceRunId: { type: Schema.Types.ObjectId, default: null },
    filters: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'done', 'failed'],
      required: true,
      default: 'pending',
    },
    partial: { type: Boolean, required: true, default: false },
    progress: { type: Schema.Types.Mixed, default: null },
    stages: { type: Schema.Types.Mixed, default: {} },
    dataFingerprint: {
      count: { type: Number, required: true, min: 0 },
      maxUpdatedAt: { type: Date, default: null },
    },
    detailCount: { type: Number, default: null, min: 0 },
    inputKey: { type: String, required: true },
    resultsKey: { type: String, required: true },
    error: { type: { code: String, message: String }, default: null, _id: false },
    requestedBy: { type: Schema.Types.ObjectId, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { ...SCHEMA_OPTIONS, minimize: false },
);

export const analysisRunsModel = (connection: Connection) =>
  modelFor(connection, 'AnalysisRun', RunSchema, 'analysis_runs');
