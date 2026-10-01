import { DETAIL_EVENTS, type DetailEventName, type DetailEvents } from '@reqcanvas/shared';
import fp from 'fastify-plugin';
import { Types } from 'mongoose';
import { auditService, type AuditEvent } from '../audit/service.js';

const isDetailEvent = (name: string): name is DetailEventName =>
  (DETAIL_EVENTS as readonly string[]).includes(name);

/** Entidad y cambios que se guardan en `audit_logs` para cada evento (constitución VI). */
function toAudit<N extends DetailEventName>(name: N, payload: DetailEvents[N]): AuditEvent {
  const event = payload as Record<string, unknown>;
  const detail = event.detail as { id: string; activityKey: string; type: string } | undefined;
  const comment = event.comment as { id: string; detailId: string } | undefined;
  const entity = comment
    ? { type: 'comment', id: comment.id }
    : name === 'comment.deleted'
      ? { type: 'comment', id: String(event.commentId) }
      : { type: 'detail', id: String(detail?.id ?? event.detailId) };
  const diff: Record<string, unknown> = {};
  for (const key of [
    'activityKey',
    'status',
    'duplicateOf',
    'discardReason',
    'from',
    'to',
    'voted',
    'rev',
  ]) {
    if (event[key] !== undefined) diff[key] = event[key];
  }
  if (detail) Object.assign(diff, { activityKey: detail.activityKey, type: detail.type });
  if (comment) diff.detailId = comment.detailId;
  return {
    actorId: new Types.ObjectId(String(event.actorId)),
    projectId: new Types.ObjectId(String(event.projectId)),
    entity,
    diff,
  };
}

/**
 * Registra en la auditoría cada evento de los detalles (constitución VI). Los de diagramas,
 * proyectos y miembros ya los auditan sus servicios.
 */
export const detailAuditPlugin = fp(
  async (app) => {
    const audit = auditService(app.mongo, app.log);
    app.domainEvents.onAny((name, payload) => {
      if (isDetailEvent(name)) {
        return audit.record(name, toAudit(name, payload as DetailEvents[typeof name]));
      }
    });
  },
  { name: 'detail-audit', dependencies: ['mongo', 'domain-events'] },
);
