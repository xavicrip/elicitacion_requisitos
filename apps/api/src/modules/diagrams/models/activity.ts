import type { ActivityType, BBox } from '@reqcanvas/shared';
import { randomUUID } from 'node:crypto';
import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../../lib/model.js';

export type Activity = {
  _id: Types.ObjectId;
  versionId: Types.ObjectId;
  diagramId: Types.ObjectId;
  projectId: Types.ObjectId;
  /** UUID estable entre versiones del diagrama: el ancla de los requisitos (004). */
  key: string;
  label: string;
  type: ActivityType;
  /** Normalizada en [0, 1] respecto a la imagen display. */
  bbox: BBox;
  /** `key` de las actividades destino de la misma versión. */
  next: string[];
  source: 'manual' | 'detected';
  /** Se incrementa en cada cambio; se exige en `If-Match`. */
  rev: number;
  createdAt: Date;
  updatedAt: Date;
};

const BBoxSchema = new Schema<BBox>(
  {
    x: { type: Number, required: true, min: 0, max: 1 },
    y: { type: Number, required: true, min: 0, max: 1 },
    w: { type: Number, required: true, min: 0, max: 1 },
    h: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const ActivitySchema = new Schema<Activity>(
  {
    versionId: { type: Schema.Types.ObjectId, required: true },
    diagramId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true, default: () => randomUUID() },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: ['action', 'decision', 'start', 'end'], required: true },
    bbox: { type: BBoxSchema, required: true },
    next: { type: [String], default: [] },
    source: { type: String, enum: ['manual', 'detected'], required: true, default: 'manual' },
    rev: { type: Number, required: true, default: 0 },
  },
  SCHEMA_OPTIONS,
);

export const activitiesModel = (connection: Connection) =>
  modelFor(connection, 'Activity', ActivitySchema, 'activities');
