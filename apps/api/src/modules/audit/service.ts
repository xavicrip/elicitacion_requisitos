import type { Connection, Types } from 'mongoose';
import { auditLogsModel } from './model.js';

export type AuditEvent = {
  actorId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  entity: { type: string; id: string };
  diff?: Record<string, unknown>;
};

type Logger = { warn: (obj: object, msg: string) => void };

/** Claves que nunca se guardan en `diff` (constitución V: sin secretos). */
const SECRET_KEY = /password|token|secret|hash/i;

function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET_KEY.test(key))
        .map(([key, inner]) => [key, withoutSecrets(inner)]),
    );
  }
  return value;
}

/**
 * Registro de auditoría (FR-013). Un fallo al auditar no interrumpe la operación del usuario:
 * se registra en el log de la aplicación para no perder la traza.
 */
export function auditService(connection: Connection, log?: Logger) {
  const AuditLogs = auditLogsModel(connection);
  return {
    async record(action: string, event: AuditEvent): Promise<void> {
      const diff = event.diff && (withoutSecrets(event.diff) as Record<string, unknown>);
      try {
        await AuditLogs.create({ ...event, action, diff, at: new Date() });
      } catch (error) {
        log?.warn(
          { err: { name: (error as Error).name }, action, entity: event.entity },
          'No se pudo registrar el evento de auditoría',
        );
      }
    },
  };
}
