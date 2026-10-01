import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useAuthStore } from '../../lib/auth-store';
import { DetailsWorkspacePage } from '../details/DetailsWorkspacePage';
import { useWorkspaceStore } from '../diagrams/workspace/store';
import { projectKeys, projectsApi } from '../projects/api';
import { useRealtimeSocket } from './socket';
import { useRealtimeRoom, useRealtimeSync } from './useRealtimeSync';

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
  const room = useRealtimeRoom(socket, versionId || null);
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
      <DetailsWorkspacePage />
    </>
  );
}
