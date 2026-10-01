import type { DetailEventName, DetailEvents } from '@reqcanvas/shared';
import fp from 'fastify-plugin';
import { Types } from 'mongoose';
import { auditService, type AuditEvent } from '../audit/service.js';

type Logger = { warn: (obj: object, msg: string) => void };
type Listener<N extends DetailEventName> = (payload: DetailEvents[N]) => unknown;
type AnyListener = <N extends DetailEventName>(name: N, payload: DetailEvents[N]) => unknown;

declare module 'fastify' {
  interface FastifyInstance {
    /** Eventos de dominio de los detalles (contracts/domain-events.md); la 005 los retransmite. */
    detailEvents: DetailEventBus;
  }
}

/** Quita los datos calculados para un usuario: los eventos son para todos los miembros. */
function withoutUserData<N extends DetailEventName>(payload: DetailEvents[N]): DetailEvents[N] {
  const copy = { ...payload } as Record<string, unknown>;
  for (const field of ['detail', 'comment']) {
    if (copy[field] && typeof copy[field] === 'object') {
      const {
        permissions: _permissions,
        votedByMe: _voted,
        ...rest
      } = copy[field] as Record<string, unknown>;
      copy[field] = rest;
    }
  }
  return copy as DetailEvents[N];
}

/**
 * Bus de eventos en proceso (research R10). Se emite **después** de confirmar la escritura; un
 * suscriptor que falla no interrumpe a los demás ni la petición del usuario.
 */
export function createDetailEvents(log: Logger) {
  const listeners = new Map<DetailEventName, Set<Listener<never>>>();
  const anyListeners = new Set<AnyListener>();

  const safely = async (event: DetailEventName, run: () => unknown) => {
    try {
      await run();
    } catch (error) {
      log.warn({ err: { name: (error as Error).name }, event }, 'Falló un suscriptor de eventos');
    }
  };

  return {
    on<N extends DetailEventName>(name: N, listener: Listener<N>): () => void {
      const set = listeners.get(name) ?? new Set();
      set.add(listener as Listener<never>);
      listeners.set(name, set);
      return () => set.delete(listener as Listener<never>);
    },
    onAny(listener: AnyListener): () => void {
      anyListeners.add(listener);
      return () => anyListeners.delete(listener);
    },
    async emit<N extends DetailEventName>(name: N, payload: DetailEvents[N]): Promise<void> {
      const clean = withoutUserData(payload);
      for (const listener of listeners.get(name) ?? []) {
        await safely(name, () => (listener as Listener<N>)(clean));
      }
      for (const listener of anyListeners) await safely(name, () => listener(name, clean));
    },
  };
}

export type DetailEventBus = ReturnType<typeof createDetailEvents>;

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

/** Decora `app.detailEvents` y registra en la auditoría cada evento emitido. */
export const detailEventsPlugin = fp(
  async (app) => {
    const events = createDetailEvents(app.log);
    const audit = auditService(app.mongo, app.log);
    events.onAny((name, payload) => audit.record(name, toAudit(name, payload)));
    app.decorate('detailEvents', events);
  },
  { name: 'detail-events', dependencies: ['mongo'] },
);
