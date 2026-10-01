import { create } from 'zustand';
import { getConfig } from '../../../lib/config';
import type { Camera, CameraCommand, Size } from './camera/zoom';

export type WorkspaceMode = 'view' | 'edit';
export type ImageStatus = 'loading' | 'ready' | 'error';

/** Estado del espacio de trabajo (contracts/canvas-ui.md); lo extienden las features 004–006. */
export type WorkspaceState = {
  versionId: string;
  mode: WorkspaceMode;
  selectedActivityKey: string | null;
  hoveredActivityKey: string | null;
  /** Coordenadas de imagen (px). */
  camera: Camera;
  /** Textura del canvas: la leen el aviso de carga y los E2E. */
  imageStatus: ImageStatus;
  /** Capas opcionales, p. ej. 'heatmap' (004), 'presence' (005), 'proposals' (006). */
  overlays: Record<string, boolean>;
  /** Tamaño del canvas en px de pantalla (minimapa y órdenes de cámara). */
  viewport: Size;
  /** Última orden pendiente para la cámara; `id` distingue dos órdenes iguales seguidas. */
  cameraCommand: { id: number; command: CameraCommand } | null;
};

type WorkspaceActions = {
  open(versionId: string, mode: WorkspaceMode): void;
  select(key: string | null): void;
  hover(key: string | null): void;
  setCamera(camera: Camera): void;
  setImageStatus(status: ImageStatus): void;
  setOverlay(name: string, enabled: boolean): void;
  setViewport(viewport: Size): void;
  requestCamera(command: CameraCommand): void;
  reset(): void;
};

const initial: WorkspaceState = {
  versionId: '',
  mode: 'view',
  selectedActivityKey: null,
  hoveredActivityKey: null,
  camera: { zoom: 1, center: { x: 0, y: 0 } },
  imageStatus: 'loading',
  overlays: {},
  viewport: { width: 0, height: 0 },
  cameraCommand: null,
};

export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>()((set) => ({
  ...initial,
  open: (versionId, mode) =>
    set({
      versionId,
      mode,
      selectedActivityKey: null,
      hoveredActivityKey: null,
      imageStatus: 'loading',
    }),
  select: (key) => set({ selectedActivityKey: key }),
  hover: (key) => set({ hoveredActivityKey: key }),
  setCamera: (camera) => set({ camera }),
  setImageStatus: (imageStatus) => set({ imageStatus }),
  setOverlay: (name, enabled) =>
    set((state) => ({ overlays: { ...state.overlays, [name]: enabled } })),
  setViewport: (viewport) => set({ viewport }),
  requestCamera: (command) =>
    set((state) => ({ cameraCommand: { id: (state.cameraCommand?.id ?? 0) + 1, command } })),
  reset: () => set(initial),
}));

declare global {
  interface Window {
    /** Solo con `e2eHooks` en `/config.js` (Compose y CI; nunca Railway). */
    __canvasState?: WorkspaceState;
  }
}

/**
 * Expone el estado en `window.__canvasState` para los E2E: el canvas WebGL no se puede
 * inspeccionar desde el DOM. Se decide en tiempo de ejecución (plan ajuste 8), porque la imagen
 * de `web` se construye siempre en modo producción.
 */
export function exposeWorkspaceForE2E(): void {
  if (!getConfig().e2eHooks) return;
  Object.defineProperty(window, '__canvasState', {
    configurable: true,
    get: (): WorkspaceState => {
      const state = useWorkspaceStore.getState();
      return Object.fromEntries(
        Object.entries(state).filter(([, value]) => typeof value !== 'function'),
      ) as WorkspaceState;
    },
  });
}
