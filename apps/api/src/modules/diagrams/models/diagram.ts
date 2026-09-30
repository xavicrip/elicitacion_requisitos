import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../../lib/model.js';

export type Diagram = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  /** Posición en la lista del proyecto. */
  order: number;
  /** Versión visible para los participantes. */
  publishedVersionId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

const DiagramSchema = new Schema<Diagram>(
  {
    projectId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    order: { type: Number, required: true, default: 0 },
    publishedVersionId: { type: Schema.Types.ObjectId, default: null },
  },
  SCHEMA_OPTIONS,
);

export const diagramsModel = (connection: Connection) =>
  modelFor(connection, 'Diagram', DiagramSchema, 'diagrams');
