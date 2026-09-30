import type { VersionStatus } from '@reqcanvas/shared';
import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../../lib/model.js';

/** Claves de los objetos en el bucket; `width`/`height` son los de la imagen display. */
export type VersionImage = {
  originalKey: string;
  displayKey: string;
  thumbKey: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
};

export type DiagramVersion = {
  _id: Types.ObjectId;
  diagramId: Types.ObjectId;
  projectId: Types.ObjectId;
  /** 1, 2, 3… por diagrama. */
  number: number;
  /** Máx. 1 `published` y 1 `draft` por diagrama (índices parciales únicos). */
  status: VersionStatus;
  image: VersionImage;
  publishedAt?: Date | null;
  createdBy: Types.ObjectId;
  /** Concurrencia optimista de la versión (publicar exige el `rev` leído). */
  rev: number;
  createdAt: Date;
  updatedAt: Date;
};

const ImageSchema = new Schema<VersionImage>(
  {
    originalKey: { type: String, required: true },
    displayKey: { type: String, required: true },
    thumbKey: { type: String, required: true },
    mime: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    bytes: { type: Number, required: true },
  },
  { _id: false },
);

const VersionSchema = new Schema<DiagramVersion>(
  {
    diagramId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    number: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      required: true,
      default: 'draft',
    },
    image: { type: ImageSchema, required: true },
    publishedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    rev: { type: Number, required: true, default: 0 },
  },
  SCHEMA_OPTIONS,
);

export const versionsModel = (connection: Connection) =>
  modelFor(connection, 'DiagramVersion', VersionSchema, 'diagram_versions');
