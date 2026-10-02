import type { ClientToServerEvents, ServerToClientEvents } from '@reqcanvas/shared';
import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { refreshSession } from '../../lib/api-client';
import { useAuthStore } from '../../lib/auth-store';
import { useFlags } from '../../lib/flags';
import { useConnectionStore } from './connection';

export type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Se renueva la sesión este tiempo antes de que caduque el access token. */
const REFRESH_BEFORE_MS = 60_000;

let socket: RealtimeSocket | null = null;
let creating: Promise<RealtimeSocket> | null = null;
let users = 0;
let cleanups: Array<() => void> = [];

/** Caducidad (epoch ms) de un access token; el cliente solo lee `exp`, no lo verifica. */
function expiresAt(token: string | null): number | null {
  try {
    const payload = JSON.parse(atob(token!.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function create(): Promise<RealtimeSocket> {
  // socket.io-client va en el chunk del espacio de trabajo, no en el bundle inicial.
  const { io } = await import('socket.io-client');
  const setStatus = useConnectionStore.getState().setStatus;
  const created: RealtimeSocket = io({
    transports: ['websocket'],
    autoConnect: false,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    // Función: cada (re)conexión envía el token vigente.
    auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
  });

  // Renovar la sesión antes de que caduque el token: el servidor desconecta sin renovar.
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    const expiry = expiresAt(useAuthStore.getState().accessToken);
    if (expiry === null) return;
    refreshTimer = setTimeout(
      () => void refreshSession(),
      Math.max(0, expiry - REFRESH_BEFORE_MS - Date.now()),
    );
  };

  let retriedAuth = false;
  created.on('connect', () => {
    retriedAuth = false;
    setStatus('connected');
    scheduleRefresh();
  });
  created.on('disconnect', () => setStatus('disconnected'));
  created.io.on('reconnect_attempt', () => setStatus('connecting'));
  created.on('connect_error', async (error) => {
    setStatus('disconnected');
    // Error del middleware: Socket.IO no reintenta solo. Se refresca la sesión una vez.
    if (error.message !== 'unauthorized' || retriedAuth) return;
    retriedAuth = true;
    if (await refreshSession()) {
      setStatus('connecting');
      created.connect();
    }
  });

  const unsubscribe = useAuthStore.subscribe((state, previous) => {
    if (state.accessToken === previous.accessToken || !state.accessToken) return;
    if (created.connected) created.emit('auth:refresh', { token: state.accessToken }, () => {});
    scheduleRefresh();
  });
  // El navegador sabe antes que el socket que no hay red: sin esto, Socket.IO solo lo notaría
  // al no recibir el ping (hasta 45 s). Cerrar el transporte activa el aviso y la reconexión.
  const onOffline = () => {
    if (users > 0 && created.connected) created.io.engine.close();
  };
  const onOnline = () => {
    if (users > 0 && !created.connected) created.connect();
  };
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);

  cleanups = [
    unsubscribe,
    () => clearTimeout(refreshTimer),
    () => window.removeEventListener('offline', onOffline),
    () => window.removeEventListener('online', onOnline),
  ];
  return created;
}

/** Socket de la pestaña (uno solo, compartido); lo conecta si no lo estaba. */
export async function acquireSocket(): Promise<RealtimeSocket> {
  users += 1;
  creating ??= create();
  socket = await creating;
  if (!socket.connected) {
    useConnectionStore.getState().setStatus('connecting');
    socket.connect();
  }
  return socket;
}

/** Deja de usar el socket; al soltarlo el último, se desconecta. */
export function releaseSocket() {
  users = Math.max(0, users - 1);
  if (users === 0 && socket) {
    socket.disconnect();
    useConnectionStore.getState().setStatus('idle');
  }
}

/** Solo para las pruebas: olvida el socket y su estado. */
export function resetSocketForTests() {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  socket = null;
  creating = null;
  users = 0;
  useConnectionStore.getState().reset();
}

/** Socket para un componente, solo con el flag `realtime`; `null` mientras no hay. */
export function useRealtimeSocket(): RealtimeSocket | null {
  const { flags } = useFlags();
  const enabled = Boolean(flags.realtime);
  const [current, setCurrent] = useState<RealtimeSocket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void acquireSocket().then((acquired) => {
      if (active) setCurrent(acquired);
    });
    return () => {
      active = false;
      releaseSocket();
      setCurrent(null);
    };
  }, [enabled]);

  return current;
}
