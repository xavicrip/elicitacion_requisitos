import { io } from 'socket.io-client';

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
