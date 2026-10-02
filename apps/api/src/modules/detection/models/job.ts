import type { DetectionJobStatus, DetectionStage } from '@reqcanvas/shared';
import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../../lib/model.js';

/** Ejecución de la detección sobre una versión (data-model.md); `_id` es el `jobId` de BullMQ. */
export type DetectionJobDoc = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  diagramId: Types.ObjectId;
  versionId: Types.ObjectId;
  /** Estados de la constitución VI. */
  status: DetectionJobStatus;
  progress: { stage: DetectionStage; pct: number };
  options: { llmRefine: boolean; arrows: boolean; languages: string[] };
  /** Mensaje en español, sin detalles internos. */
  error: { code: string; message: string } | null;
  metrics: {
    proposed: number;
    accepted: number;
    edited: number;
    discarded: number;
    durationMs: number | null;
    llmUsed: boolean;
  };
  requestedBy: Types.ObjectId;
  /** Una réplica de `api` está guardando el resultado (evita guardarlo dos veces). */
  storingAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const count = { type: Number, required: true, default: 0, min: 0 };

const JobSchema = new Schema<DetectionJobDoc>(
  {
    projectId: { type: Schema.Types.ObjectId, required: true },
    diagramId: { type: Schema.Types.ObjectId, required: true },
    versionId: { type: Schema.Types.ObjectId, required: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'done', 'failed'],
      required: true,
      default: 'pending',
    },
    progress: {
      stage: {
        type: String,
        enum: ['download', 'shapes', 'ocr', 'arrows', 'refine'],
        default: 'download',
      },
      pct: { type: Number, min: 0, max: 100, default: 0 },
    },
    options: {
      llmRefine: { type: Boolean, required: true },
      arrows: { type: Boolean, required: true },
      languages: { type: [String], required: true },
    },
    error: { type: { code: String, message: String }, default: null, _id: false },
    metrics: {
      proposed: count,
      accepted: count,
      edited: count,
      discarded: count,
      durationMs: { type: Number, default: null },
      llmUsed: { type: Boolean, required: true, default: false },
    },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    storingAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  SCHEMA_OPTIONS,
);

export const detectionJobsModel = (connection: Connection) =>
  modelFor(connection, 'DetectionJob', JobSchema, 'detection_jobs');
