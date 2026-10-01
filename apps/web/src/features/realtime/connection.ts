import { create } from 'zustand';

/**
 * Estado del socket de la pestaña (feature 005): `connecting` al abrirlo o al reintentar,
 * `disconnected` cuando se corta (el aviso "Sin conexión: reintentando" y guardar
 * deshabilitado, US4).
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

export const useConnectionStore = create<{
  status: ConnectionStatus;
  setStatus(status: ConnectionStatus): void;
}>((set) => ({
  status: 'idle',
  setStatus: (status) => set({ status }),
}));
