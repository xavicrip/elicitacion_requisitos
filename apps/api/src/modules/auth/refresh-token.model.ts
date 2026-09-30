import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../lib/model.js';

export type RefreshToken = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** Familia de sesión: todos los tokens rotados desde un mismo login (research R1). */
  sid: string;
  /** SHA-256 del token opaco; el token solo viaja en la cookie `rt`. */
  tokenHash: string;
  expiresAt: Date;
  /** Si se presenta un token ya rotado, se revoca toda la familia `sid`. */
  rotatedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const RefreshTokenSchema = new Schema<RefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    sid: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    rotatedAt: Date,
    revokedAt: Date,
  },
  SCHEMA_OPTIONS,
);

export const refreshTokensModel = (connection: Connection) =>
  modelFor(connection, 'RefreshToken', RefreshTokenSchema, 'refresh_tokens');
