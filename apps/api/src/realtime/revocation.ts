import type { FastifyInstance } from 'fastify';
import type { PresenceService } from './presence.js';
import { diagramRoom, projectRoom, userRoom } from './rooms.js';

/**
 * Revocación inmediata (FR-008, research R7): retirar o salir de un proyecto y borrarlo sacan a
 * los sockets afectados de sus salas y de la presencia y les avisan; cerrar o reabrir lo
 * anuncia a la sala. `fetchSockets` y `leave` llegan a los sockets de cualquier réplica.
 */
export function registerRevocation(app: FastifyInstance, presence: PresenceService) {
  /** Saca de las salas del proyecto a los sockets de `room` (un usuario o todo el proyecto). */
  async function evict(room: string, projectId: string) {
    for (const socket of await app.io.in(room).fetchSockets()) {
      const versions = Object.entries(socket.data.joined ?? {})
        .filter(([, project]) => project === projectId)
        .map(([versionId]) => versionId);
      socket.leave(projectRoom(projectId));
      for (const versionId of versions) {
        socket.leave(diagramRoom(versionId));
        await presence.remove(versionId, socket.data.userId, socket.id);
      }
    }
  }

  const removed = async ({ projectId, userId }: { projectId: string; userId: string }) => {
    app.io.to(userRoom(userId)).emit('access:revoked', { projectId, reason: 'removed' });
    await evict(userRoom(userId), projectId);
  };
  app.domainEvents.on('member.removed', removed);
  app.domainEvents.on('member.left', removed);

  app.domainEvents.on('project.deleted', async ({ projectId }) => {
    app.io.to(projectRoom(projectId)).emit('access:revoked', { projectId, reason: 'deleted' });
    await evict(projectRoom(projectId), projectId);
  });

  app.domainEvents.on('project.status_changed', ({ projectId, from, to }) => {
    if (to === 'closed') app.io.to(projectRoom(projectId)).emit('project:closed', { projectId });
    else if (from === 'closed' && to === 'open') {
      app.io.to(projectRoom(projectId)).emit('project:reopened', { projectId });
    }
  });
}
