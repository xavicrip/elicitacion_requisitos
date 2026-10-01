import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor } from '../../../lib/model.js';

export type DetailComment = {
  _id: Types.ObjectId;
  detailId: Types.ObjectId;
  projectId: Types.ObjectId;
  authorId: Types.ObjectId;
  text: string;
  editedAt: Date | null;
  createdAt: Date;
};

const CommentSchema = new Schema<DetailComment>(
  {
    detailId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    authorId: { type: Schema.Types.ObjectId, required: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    editedAt: { type: Date, default: null },
  },
  // `editedAt` solo cambia cuando el autor edita el texto (no en cada escritura).
  {
    autoIndex: false,
    autoCreate: false,
    versionKey: false,
    timestamps: { createdAt: true, updatedAt: false },
  },
);

export const commentsModel = (connection: Connection) =>
  modelFor(connection, 'DetailComment', CommentSchema, 'detail_comments');
