import type { Activity, PresenceEntry, PresenceUpdate } from '@reqcanvas/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useWorkspaceEvents } from '../diagrams/workspace/useWorkspaceEvents';
import { useWorkspaceStore } from '../diagrams/workspace/store';
import type { RealtimeSocket } from './socket';

/** Latido de presencia (research R5): sin él en 10 s, los demás dejan de ver a esta persona. */
const HEARTBEAT_MS = 5_000;

type Listener = { on(name: string, h: unknown): unknown; off(name: string, h: unknown): unknown };

/**
 * Presencia del diagrama (US2): parte del estado del `room:join`, se actualiza con
 * `presence:update`, late cada 5 s y envía la actividad seleccionada mientras está en la sala.
 */
export function usePresence(
  socket: RealtimeSocket | null,
  versionId: string | null,
  initial: PresenceEntry[],
  joined: boolean,
): PresenceEntry[] {
  const [entries, setEntries] = useState(initial);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  // El estado del ack, al unirse a la sala (o al cambiar de versión).
  useEffect(() => setEntries(initialRef.current), [versionId, joined]);

  useEffect(() => {
    if (!socket) return;
    const handler = (update: PresenceUpdate) => setEntries(update.entries);
    (socket as unknown as Listener).on('presence:update', handler);
    return () => void (socket as unknown as Listener).off('presence:update', handler);
  }, [socket]);

  useEffect(() => {
    if (!socket || !versionId || !joined) return;
    useWorkspaceStore.getState().setOverlay('presence', true);
    const timer = setInterval(() => socket.emit('presence:heartbeat', { versionId }), HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      useWorkspaceStore.getState().setOverlay('presence', false);
    };
  }, [socket, versionId, joined]);

  useWorkspaceEvents((event) => {
    if (event.type !== 'activity:selected' || !socket || !versionId || !joined) return;
    socket.emit('presence:select', { versionId, activityKey: event.key });
  });

  return entries;
}

/**
 * Indicador sobre cada actividad con el color de quien la tiene seleccionada (FR-004), para el
 * punto de extensión `renderBadge` de la 003.
 */
export function presenceBadge(entries: PresenceEntry[], userId: string) {
  return (activity: Activity): ReactNode => {
    const here = entries.filter(
      (entry) => entry.userId !== userId && entry.selectedActivityKey === activity.key,
    );
    if (here.length === 0) return null;
    return (
      <span className="mt-1 flex flex-wrap gap-1">
        {here.map((entry) => (
          <span
            key={entry.userId}
            aria-label={`${entry.name} tiene seleccionada esta actividad`}
            title={entry.name}
            className="rounded-full border-2 bg-white px-1.5 text-xs font-medium"
            style={{ borderColor: entry.color, color: entry.color }}
          >
            {entry.name.split(/\s+/)[0]}
          </span>
        ))}
      </span>
    );
  };
}
