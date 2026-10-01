import type { ClientToServerEvents, ServerToClientEvents } from '@reqcanvas/shared';
import { io, type Socket } from 'socket.io-client';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Intenta un handshake WebSocket con Socket.IO; devuelve `'connected'` o el mensaje de error. */
export async function tryHandshake(
  url: string,
  auth?: Record<string, unknown>,
): Promise<'connected' | string> {
  const socket = io(url, { transports: ['websocket'], reconnection: false, timeout: 3000, auth });
  try {
    return await new Promise((resolve) => {
      socket.on('connect', () => resolve('connected'));
      socket.on('connect_error', (error) => resolve(error.message));
    });
  } finally {
    socket.close();
  }
}

const opened: ClientSocket[] = [];

/** Socket conectado con el access token (como el cliente web: solo WebSocket). */
export async function connect(url: string, token: string): Promise<ClientSocket> {
  const socket: ClientSocket = io(url, {
    transports: ['websocket'],
    reconnection: false,
    auth: { token },
  });
  opened.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

/** Cierra todos los sockets abiertos con `connect`. */
export function closeSockets() {
  for (const socket of opened.splice(0)) socket.close();
}

/** Espera el siguiente evento `name` (o falla tras `timeoutMs`). */
export function nextEvent<T = unknown>(
  socket: ClientSocket,
  name: string,
  timeoutMs = 2000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Sin evento ${name}`)), timeoutMs);
    (socket as unknown as Socket).once(name, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Recoge los eventos `name` que llegan a un socket. */
export function collect<T = unknown>(socket: ClientSocket, name: string): T[] {
  const received: T[] = [];
  (socket as unknown as Socket).on(name, (payload: T) => received.push(payload));
  return received;
}

/** Espera a que un socket se desconecte (o falla tras `timeoutMs`). */
export function disconnected(socket: ClientSocket, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!socket.connected) return resolve('ya desconectado');
    const timer = setTimeout(() => reject(new Error('Sigue conectado')), timeoutMs);
    socket.once('disconnect', (reason) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
