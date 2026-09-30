import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../lib/model.js';

export type Invitation = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  /** SHA-256 del token; el token solo se devuelve al crear la invitación (research R8). */
  tokenHash: string;
  createdBy: Types.ObjectId;
  expiresAt: Date;
  revokedAt?: Date;
  /** Contador informativo de aceptaciones. */
  uses: number;
  createdAt: Date;
  updatedAt: Date;
};

const InvitationSchema = new Schema<Invitation>(
  {
    projectId: { type: Schema.Types.ObjectId, required: true },
    tokenHash: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    uses: { type: Number, required: true, default: 0 },
  },
  SCHEMA_OPTIONS,
);

export const invitationsModel = (connection: Connection) =>
  modelFor(connection, 'Invitation', InvitationSchema, 'invitations');
