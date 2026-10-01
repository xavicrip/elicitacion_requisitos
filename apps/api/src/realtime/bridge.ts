import { randomUUID } from 'node:crypto';
import { RELAYED_EVENTS, type RelayedEventName } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { projectRoom } from './rooms.js';

const isRelayed = (name: string): name is RelayedEventName =>
  (RELAYED_EVENTS as readonly string[]).includes(name);

/**
 * Puente entre los eventos de dominio y el socket (research R3): cada evento de detalles y de
 * publicación va a la sala del proyecto con un `eventId` para que el cliente lo aplique una sola
 * vez. El adaptador Redis lo reparte a los sockets de todas las réplicas (plan, ajuste 5).
 */
export function registerBridge(app: FastifyInstance) {
  app.domainEvents.onAny((name, payload) => {
    if (!isRelayed(name)) return;
    // `name` es genérico: TypeScript no puede emparejarlo con su payload en `emit`.
    const room = app.io.to(projectRoom(payload.projectId));
    const emit = room.emit as (event: RelayedEventName, payload: object) => boolean;
    emit.call(room, name, { ...payload, eventId: randomUUID() });
  });
}
