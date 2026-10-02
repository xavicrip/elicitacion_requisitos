import { randomUUID } from 'node:crypto';
import {
  DETECTION_EVENTS,
  RELAYED_EVENTS,
  type DetectionEventName,
  type RelayedEventName,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { diagramRoom, projectRoom } from './rooms.js';

const isRelayed = (name: string): name is RelayedEventName =>
  (RELAYED_EVENTS as readonly string[]).includes(name);
const isDetection = (name: string): name is DetectionEventName =>
  (DETECTION_EVENTS as readonly string[]).includes(name);

/**
 * Puente entre los eventos de dominio y el socket (research R3): cada evento de detalles y de
 * publicación va a la sala del proyecto con un `eventId` para que el cliente lo aplique una sola
 * vez. El adaptador Redis lo reparte a los sockets de todas las réplicas (plan, ajuste 5).
 */
export function registerBridge(app: FastifyInstance) {
  app.domainEvents.onAny((name, payload) => {
    // La detección (006) va a la sala de la versión: solo la ve quien puede ver el borrador.
    if (isDetection(name)) {
      const { versionId } = payload as { versionId: string };
      const room = app.io.to(diagramRoom(versionId));
      const emit = room.emit as (event: DetectionEventName, payload: object) => boolean;
      emit.call(room, name, { ...payload, eventId: randomUUID() });
      return;
    }
    if (!isRelayed(name)) return;
    // `name` es genérico: TypeScript no puede emparejarlo con su payload en `emit`.
    const room = app.io.to(projectRoom(payload.projectId));
    const emit = room.emit as (event: RelayedEventName, payload: object) => boolean;
    emit.call(room, name, { ...payload, eventId: randomUUID() });
  });
}
