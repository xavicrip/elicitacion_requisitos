import { create } from 'zustand';

/**
 * Estado del socket de la pestaña (feature 005): `connecting` al abrirlo o al reintentar,
 * `disconnected` cuando se corta (el aviso "Sin conexión: reintentando" y guardar
 * deshabilitado, US4).
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

type ConnectionState = {
  status: ConnectionStatus;
  /** Ya estuvo conectado: un `connecting` posterior es un reintento, no el primer intento. */
  everConnected: boolean;
  setStatus(status: ConnectionStatus): void;
  reset(): void;
};

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'idle',
  everConnected: false,
  setStatus: (status) =>
    set((state) => ({
      status,
      everConnected: status === 'idle' ? false : state.everConnected || status === 'connected',
    })),
  reset: () => set({ status: 'idle', everConnected: false }),
}));

/** Se perdió la conexión en tiempo real y aún no ha vuelto (US4 escenario 1). */
export const isOffline = (state: Pick<ConnectionState, 'status' | 'everConnected'>) =>
  state.everConnected && (state.status === 'disconnected' || state.status === 'connecting');

/**
 * ¿Se puede guardar? Sin conexión en tiempo real, no: lo guardado no llegaría a los demás y el
 * borrador se conserva (FR-007). Sin el flag `realtime`, siempre.
 */
export const useCanWrite = () => useConnectionStore((state) => !isOffline(state));
