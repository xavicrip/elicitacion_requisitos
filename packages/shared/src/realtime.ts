import { z } from 'zod';
import type { DetailEventName, DetailEvents } from './events';

/**
 * Contrato de Socket.IO de la colaboración en tiempo real
 * (specs/005-colaboracion-tiempo-real/contracts/socket-events.md). Los eventos con `.` son
 * eventos de dominio retransmitidos; los que llevan `:` son propios del socket.
 */

const Id = z.string().min(1);

// Cliente → servidor. El servidor valida cada payload y descarta los inválidos.

/** `room:join`, `room:leave` y `presence:heartbeat`. */
export const VersionRoomSchema = z.object({ versionId: Id });
export const PresenceSelectSchema = z.object({ versionId: Id, activityKey: Id.nullable() });
/** Coordenadas de imagen (px), no de pantalla: cada cliente tiene su propio zoom. */
const ImageCoordinate = z.number().min(0).max(Number.MAX_SAFE_INTEGER);
export const CursorMoveSchema = z.object({ versionId: Id, x: ImageCoordinate, y: ImageCoordinate });
export const AuthRefreshSchema = z.object({ token: Id });

export type VersionRoom = z.infer<typeof VersionRoomSchema>;
export type PresenceSelect = z.infer<typeof PresenceSelectSchema>;
export type CursorMove = z.infer<typeof CursorMoveSchema>;
export type AuthRefresh = z.infer<typeof AuthRefreshSchema>;

export const CLIENT_EVENTS = [
  'room:join',
  'room:leave',
  'presence:heartbeat',
  'presence:select',
  'cursor:move',
  'auth:refresh',
] as const;

// Servidor → cliente, propios del socket.

export const PresenceEntrySchema = z.object({
  userId: Id,
  name: z.string(),
  color: z.string().regex(/^#[0-9A-F]{6}$/),
  selectedActivityKey: Id.nullable(),
});
export type PresenceEntry = z.infer<typeof PresenceEntrySchema>;

/** Estado completo de la presencia del diagrama (≤ 50 personas, SC-002). */
export const PresenceUpdateSchema = z.object({ entries: z.array(PresenceEntrySchema).max(50) });
export const CursorMovedSchema = z.object({ userId: Id, x: ImageCoordinate, y: ImageCoordinate });
export const AccessRevokedSchema = z.object({
  projectId: Id,
  reason: z.enum(['removed', 'deleted']),
});
/** `project:closed` y `project:reopened`. */
export const ProjectRoomSchema = z.object({ projectId: Id });

export type PresenceUpdate = z.infer<typeof PresenceUpdateSchema>;
export type CursorMoved = z.infer<typeof CursorMovedSchema>;
export type AccessRevoked = z.infer<typeof AccessRevokedSchema>;
export type ProjectRoom = z.infer<typeof ProjectRoomSchema>;

export const SOCKET_SERVER_EVENTS = [
  'presence:update',
  'cursor:moved',
  'access:revoked',
  'project:closed',
  'project:reopened',
] as const;

/** Respuesta de `room:join`. */
export type JoinAck =
  { ok: true; presence: PresenceEntry[] } | { ok: false; code: 'not_found' | 'invalid' };

/** Un evento de dominio tal como llega por el socket: con un `eventId` para la idempotencia. */
export type Relayed<T> = T & { eventId: string };

export type ServerToClientEvents = {
  [N in DetailEventName]: (payload: Relayed<DetailEvents[N]>) => void;
} & {
  'presence:update': (payload: PresenceUpdate) => void;
  'cursor:moved': (payload: CursorMoved) => void;
  'access:revoked': (payload: AccessRevoked) => void;
  'project:closed': (payload: ProjectRoom) => void;
  'project:reopened': (payload: ProjectRoom) => void;
};

export type ClientToServerEvents = {
  'room:join': (payload: VersionRoom, ack: (result: JoinAck) => void) => void;
  'room:leave': (payload: VersionRoom) => void;
  'presence:heartbeat': (payload: VersionRoom) => void;
  'presence:select': (payload: PresenceSelect) => void;
  'cursor:move': (payload: CursorMove) => void;
  'auth:refresh': (payload: AuthRefresh, ack: (result: { ok: boolean }) => void) => void;
};

/** Paleta de presencia: 12 colores con contraste AA sobre blanco (research R5). */
export const PRESENCE_COLORS = [
  '#B91C1C',
  '#C2410C',
  '#A16207',
  '#15803D',
  '#047857',
  '#0F766E',
  '#0E7490',
  '#1D4ED8',
  '#4338CA',
  '#6D28D9',
  '#A21CAF',
  '#BE185D',
] as const;

/** Color estable de una persona: el mismo en todas las sesiones y para todos (FR-003). */
export function presenceColor(userId: string): (typeof PRESENCE_COLORS)[number] {
  // FNV-1a de 32 bits: reparte bien los ObjectId, que solo cambian en unos pocos caracteres.
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return PRESENCE_COLORS[(hash >>> 0) % PRESENCE_COLORS.length]!;
}
