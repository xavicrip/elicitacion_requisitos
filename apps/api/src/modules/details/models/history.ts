import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor } from '../../../lib/model.js';

export type HistoryChange = 'edit' | 'status' | 'reassign';

export type DetailHistory = {
  _id: Types.ObjectId;
  detailId: Types.ObjectId;
  /** Para la cascada del proyecto (data-model.md). */
  projectId: Types.ObjectId;
  /** `rev` del detalle antes del cambio. */
  rev: number;
  /** Copia de los campos editables antes del cambio (research R3). */
  snapshot: Record<string, unknown>;
  change: HistoryChange;
  editedBy: Types.ObjectId;
  editedAt: Date;
};

const HistorySchema = new Schema<DetailHistory>(
  {
    detailId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    rev: { type: Number, required: true },
    snapshot: { type: Schema.Types.Mixed, required: true },
    change: { type: String, enum: ['edit', 'status', 'reassign'], required: true },
    editedBy: { type: Schema.Types.ObjectId, required: true },
    editedAt: { type: Date, required: true, default: () => new Date() },
  },
  // Inmutable: una entrada del historial nunca se modifica.
  { autoIndex: false, autoCreate: false, versionKey: false, timestamps: false },
);

export const historyModel = (connection: Connection) =>
  modelFor(connection, 'DetailHistory', HistorySchema, 'detail_history');
