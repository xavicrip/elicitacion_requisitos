import { CursorMoveSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { createRateLimiter } from './rate-limit.js';
import { diagramRoom, logInvalid } from './rooms.js';
import type { RealtimeSocket } from './server.js';

/**
 * Cursores en vivo (research R6): coordenadas de imagen retransmitidas a la sala del diagrama
 * sin el emisor y como evento volátil (se pierde si el cliente va atrasado, en lugar de
 * encolarse). Máximo 20 por segundo y socket; los descartes se resumen en el log en una sola
 * línea cuando el socket vuelve a estar dentro del límite o se desconecta.
 */
export function registerCursors(app: FastifyInstance, socket: RealtimeSocket) {
  const allow = createRateLimiter(20);
  let dropped = 0;

  const reportDropped = () => {
    if (dropped === 0) return;
    app.log.warn(
      { event: 'cursor:move', socketId: socket.id, userId: socket.data.userId, dropped },
      'Cursores descartados por superar el límite',
    );
    dropped = 0;
  };

  socket.on('cursor:move', (input: unknown) => {
    const parsed = CursorMoveSchema.safeParse(input);
    if (!parsed.success) return logInvalid(app, socket, 'cursor:move');
    const { versionId, x, y } = parsed.data;
    const room = diagramRoom(versionId);
    if (!socket.rooms.has(room)) return;
    if (!allow()) {
      dropped++;
      return;
    }
    reportDropped();
    socket.volatile.to(room).emit('cursor:moved', { userId: socket.data.userId, x, y });
  });

  socket.on('disconnect', reportDropped);
}
