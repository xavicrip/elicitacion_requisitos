import { Schema, type Connection, type Types } from 'mongoose';
import { modelFor } from '../../lib/model.js';

/** Registro de auditoría, compartido por las features 002–008; solo escribe `api`. */
export type AuditLog = {
  _id: Types.ObjectId;
  projectId?: Types.ObjectId;
  /** Null en eventos anónimos, p. ej., un login fallido. */
  actorId?: Types.ObjectId;
  /** p. ej. `project.status_changed`, `member.role_changed`, `auth.login_failed`. */
  action: string;
  entity: { type: string; id: string };
  /** Valores anterior y nuevo, sin secretos. */
  diff?: Record<string, unknown>;
  at: Date;
};

const AuditLogSchema = new Schema<AuditLog>(
  {
    projectId: Schema.Types.ObjectId,
    actorId: Schema.Types.ObjectId,
    action: { type: String, required: true },
    entity: {
      type: { type: String, required: true },
      id: { type: String, required: true },
    },
    diff: Schema.Types.Mixed,
    at: { type: Date, required: true, default: () => new Date() },
  },
  // Sin `timestamps`: el registro es inmutable y `at` es su fecha.
  { autoIndex: false, autoCreate: false, versionKey: false },
);

export const auditLogsModel = (connection: Connection) =>
  modelFor(connection, 'AuditLog', AuditLogSchema, 'audit_logs');
