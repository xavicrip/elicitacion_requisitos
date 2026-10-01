import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor } from '../../../lib/model.js';

export type DetailVote = {
  _id: Types.ObjectId;
  detailId: Types.ObjectId;
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  createdAt: Date;
};

const VoteSchema = new Schema<DetailVote>(
  {
    detailId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
  },
  // Un voto no cambia: solo se crea o se borra.
  {
    autoIndex: false,
    autoCreate: false,
    versionKey: false,
    timestamps: { createdAt: true, updatedAt: false },
  },
);

export const votesModel = (connection: Connection) =>
  modelFor(connection, 'DetailVote', VoteSchema, 'detail_votes');
