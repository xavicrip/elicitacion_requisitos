import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../../lib/model.js';

/** Decisión del Administrador sobre un par de posibles duplicados (FR-007, US3). */
export type DuplicateDecisionDoc = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  /** Ids de los dos detalles, ordenados (un par se decide una sola vez). */
  pair: [string, string];
  decision: 'confirmed' | 'rejected';
  similarity: number | null;
  decidedBy: Types.ObjectId;
  decidedAt: Date;
};

const DecisionSchema = new Schema<DuplicateDecisionDoc>(
  {
    projectId: { type: Schema.Types.ObjectId, required: true },
    pair: { type: [String], required: true },
    decision: { type: String, enum: ['confirmed', 'rejected'], required: true },
    similarity: { type: Number, default: null, min: 0, max: 1 },
    decidedBy: { type: Schema.Types.ObjectId, required: true },
    decidedAt: { type: Date, required: true, default: () => new Date() },
  },
  SCHEMA_OPTIONS,
);

export const duplicateDecisionsModel = (connection: Connection) =>
  modelFor(connection, 'DuplicateDecision', DecisionSchema, 'duplicate_decisions');
