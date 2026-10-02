import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../../lib/model.js';

/** Valoración de un insight (US5): los "no útiles" se ocultan y orientan los siguientes. */
export type InsightFeedbackDoc = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  runId: Types.ObjectId;
  insightId: string;
  useful: boolean;
  /** Copia del texto, para pedir al modelo que no lo repita. */
  statement: string;
  userId: Types.ObjectId;
  at: Date;
};

const FeedbackSchema = new Schema<InsightFeedbackDoc>(
  {
    projectId: { type: Schema.Types.ObjectId, required: true },
    runId: { type: Schema.Types.ObjectId, required: true },
    insightId: { type: String, required: true },
    useful: { type: Boolean, required: true },
    statement: { type: String, required: true, maxlength: 2000 },
    userId: { type: Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true, default: () => new Date() },
  },
  SCHEMA_OPTIONS,
);

export const insightFeedbackModel = (connection: Connection) =>
  modelFor(connection, 'InsightFeedback', FeedbackSchema, 'insight_feedback');
