import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor, SCHEMA_OPTIONS } from '../../lib/model.js';

export type User = {
  _id: Types.ObjectId;
  name: string;
  email: string;
  /** argon2id. Nunca se serializa en respuestas ni en logs. */
  passwordHash: string;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const UserSchema = new Schema<User>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    lastLoginAt: Date,
  },
  {
    ...SCHEMA_OPTIONS,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

export const usersModel = (connection: Connection) =>
  modelFor(connection, 'User', UserSchema, 'users');
