import type { DomainEventName, DomainEvents } from '@reqcanvas/shared';
import fp from 'fastify-plugin';

type Logger = { warn: (obj: object, msg: string) => void };
type Listener<N extends DomainEventName> = (payload: DomainEvents[N]) => unknown;
type AnyListener = <N extends DomainEventName>(name: N, payload: DomainEvents[N]) => unknown;

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Eventos de dominio (detalles de la 004; diagramas, proyectos y miembros de la 005). Los
     * consumen la auditoría de los detalles y el puente de Socket.IO.
     */
    domainEvents: DomainEventBus;
  }
}

/** Quita los datos calculados para un usuario: los eventos son para todos los miembros. */
function withoutUserData<N extends DomainEventName>(payload: DomainEvents[N]): DomainEvents[N] {
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
  return copy as DomainEvents[N];
}

/**
 * Bus de eventos en proceso (research R10 de la 004). Se emite **después** de confirmar la
 * escritura; un suscriptor que falla no interrumpe a los demás ni la petición del usuario.
 */
export function createDomainEvents(log: Logger) {
  const listeners = new Map<DomainEventName, Set<Listener<never>>>();
  const anyListeners = new Set<AnyListener>();

  const safely = async (event: DomainEventName, run: () => unknown) => {
    try {
      await run();
    } catch (error) {
      log.warn({ err: { name: (error as Error).name }, event }, 'Falló un suscriptor de eventos');
    }
  };

  return {
    on<N extends DomainEventName>(name: N, listener: Listener<N>): () => void {
      const set = listeners.get(name) ?? new Set();
      set.add(listener as Listener<never>);
      listeners.set(name, set);
      return () => set.delete(listener as Listener<never>);
    },
    onAny(listener: AnyListener): () => void {
      anyListeners.add(listener);
      return () => anyListeners.delete(listener);
    },
    async emit<N extends DomainEventName>(name: N, payload: DomainEvents[N]): Promise<void> {
      const clean = withoutUserData(payload);
      for (const listener of listeners.get(name) ?? []) {
        await safely(name, () => (listener as Listener<N>)(clean));
      }
      for (const listener of anyListeners) await safely(name, () => listener(name, clean));
    },
  };
}

export type DomainEventBus = ReturnType<typeof createDomainEvents>;

/** Decora `app.domainEvents`. */
export const domainEventsPlugin = fp(
  async (app) => {
    app.decorate('domainEvents', createDomainEvents(app.log));
  },
  { name: 'domain-events' },
);
