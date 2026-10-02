import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useParams } from 'react-router';
import { useAuthStore } from '../../lib/auth-store';
import { DetailsWorkspacePage } from '../details/DetailsWorkspacePage';
import { useWorkspaceStore } from '../diagrams/workspace/store';
import { projectKeys, projectsApi } from '../projects/api';
import { ConnectionBanner } from './ConnectionBanner';
import { PresenceBar } from './PresenceBar';
import { useRealtimeSocket } from './socket';
import { presenceBadge, usePresence } from './usePresence';
import { useRealtimeLifecycle, useRealtimeSync } from './useRealtimeSync';

/**
 * Espacio de trabajo con colaboración en tiempo real (feature 005, plan ajuste 9): envuelve el
 * de la 004 como este envuelve el de la 003. Se une a la sala de la versión mostrada y aplica
 * los eventos sobre la caché. Sin el flag `realtime`, es el espacio de trabajo de la 004.
 */
export function RealtimeWorkspace() {
  const { projectId = '' } = useParams();
  const socket = useRealtimeSocket();
  const versionId = useWorkspaceStore((state) => state.versionId);
  const user = useAuthStore((state) => state.user);
  const project = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  });
  const room = useRealtimeLifecycle(socket, { projectId, versionId: versionId || null });
  const joined = room.status === 'joined';
  const presence = usePresence(socket, versionId || null, room.presence, joined);
  const badge = useMemo(
    () => (joined && user ? presenceBadge(presence, user.id) : undefined),
    [joined, presence, user],
  );
  useRealtimeSync(
    socket,
    project.data && user && versionId
      ? {
          userId: user.id,
          role: project.data.myRole,
          projectStatus: project.data.status,
          projectId,
          versionId,
        }
      : null,
  );

  return (
    <>
      {/* Estado para los E2E (`waitConnected`); no se muestra. */}
      <span hidden data-realtime-status={room.status} />
      <ConnectionBanner />
      {joined && user && <PresenceBar entries={presence} userId={user.id} />}
      <DetailsWorkspacePage extraBadge={badge} />
    </>
  );
}
