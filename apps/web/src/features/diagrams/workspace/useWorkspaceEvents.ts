import { useEffect, useRef } from 'react';
import type { Camera } from './camera/zoom';
import { useWorkspaceStore } from './store';

export type WorkspaceEvent =
  { type: 'activity:selected'; key: string | null } | { type: 'camera:changed'; camera: Camera };

/**
 * Eventos del espacio de trabajo (contracts/canvas-ui.md): la 005 los usa para la presencia y
 * los cursores de otros participantes.
 */
export function useWorkspaceEvents(onEvent: (event: WorkspaceEvent) => void) {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  useEffect(
    () =>
      useWorkspaceStore.subscribe((state, previous) => {
        if (state.selectedActivityKey !== previous.selectedActivityKey) {
          handler.current({ type: 'activity:selected', key: state.selectedActivityKey });
        }
        if (state.camera !== previous.camera) {
          handler.current({ type: 'camera:changed', camera: state.camera });
        }
      }),
    [],
  );
}
