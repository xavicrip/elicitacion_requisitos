import { PresenceSelectSchema, VersionRoomSchema, type JoinAck } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { projectsModel, type Project } from '../modules/projects/model.js';
import { versionsModel, type DiagramVersion } from '../modules/diagrams/models/version.js';
import { canSeeVersion } from '../modules/diagrams/service.js';
import { createRateLimiter } from './rate-limit.js';
import type { PresenceService } from './presence.js';
import type { RealtimeSocket } from './server.js';

export const projectRoom = (projectId: string) => `project:${projectId}`;
export const diagramRoom = (versionId: string) => `diagram:${versionId}`;
export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Manejador asíncrono que no deja promesas rechazadas sueltas: un fallo (Redis caído, la app
 * cerrándose) queda en el log sin tirar el proceso.
 */
export function safely<A extends unknown[]>(
  app: FastifyInstance,
  event: string,
  handler: (...args: A) => Promise<unknown>,
) {
  return (...args: A) => {
    handler(...args).catch((error: Error) =>
      app.log.warn({ err: { name: error.name }, event }, 'Falló un evento de socket'),
    );
  };
}

/** Deja constancia de un payload descartado (sin el payload: puede traer cualquier cosa). */
export function logInvalid(app: FastifyInstance, socket: RealtimeSocket, event: string) {
  app.log.warn(
    { event, socketId: socket.id, userId: socket.data.userId },
    `Payload de socket inválido en ${event}`,
  );
}

/**
 * Salas de un socket (research R2): `room:join` comprueba la membresía en el proyecto de la
 * versión y que pueda verla (las mismas reglas que los guards REST de la 003) y une el socket a
 * `project:{id}` y `diagram:{versionId}`; `user:{id}` se une al conectar.
 */
export function registerRooms(
  app: FastifyInstance,
  socket: RealtimeSocket,
  presence: PresenceService,
) {
  const Versions = versionsModel(app.mongo);
  const Projects = projectsModel(app.mongo);
  const allowJoin = createRateLimiter(10);
  const allowSelect = createRateLimiter(10);

  /** Proyecto de la versión si el usuario es miembro y puede verla; si no, `null`. */
  async function authorize(versionId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(versionId)) return null;
    const version = await Versions.findById(versionId, { projectId: 1, status: 1 }).lean<
      Pick<DiagramVersion, 'projectId' | 'status'>
    >();
    if (!version) return null;
    const project = await Projects.findOne(
      { _id: version.projectId, status: { $ne: 'deleting' } },
      { members: { $elemMatch: { userId: new Types.ObjectId(socket.data.userId) } } },
    ).lean<Pick<Project, 'members'>>();
    const membership = project?.members?.[0];
    if (!membership || !canSeeVersion(membership, version)) return null;
    return version.projectId.toHexString();
  }

  socket.on(
    'room:join',
    safely(app, 'room:join', async (input: unknown, ack?: (result: JoinAck) => void) => {
      const reply = (result: JoinAck) => {
        if (typeof ack === 'function') ack(result);
      };
      const parsed = VersionRoomSchema.safeParse(input);
      if (!parsed.success || !allowJoin()) {
        logInvalid(app, socket, 'room:join');
        return reply({ ok: false, code: 'invalid' });
      }
      const { versionId } = parsed.data;
      const projectId = await authorize(versionId);
      if (!projectId) return reply({ ok: false, code: 'not_found' });
      await socket.join([projectRoom(projectId), diagramRoom(versionId)]);
      socket.data.joined.set(versionId, projectId);
      reply({ ok: true, presence: await presence.join(versionId, socket) });
    }),
  );

  socket.on(
    'room:leave',
    safely(app, 'room:leave', async (input: unknown) => {
      const parsed = VersionRoomSchema.safeParse(input);
      if (!parsed.success) return logInvalid(app, socket, 'room:leave');
      const { versionId } = parsed.data;
      const projectId = socket.data.joined.get(versionId);
      if (!projectId) return;
      socket.data.joined.delete(versionId);
      await socket.leave(diagramRoom(versionId));
      await presence.leave(versionId, socket);
      // Sigue en la sala del proyecto si ve otro diagrama del mismo proyecto.
      if (![...socket.data.joined.values()].includes(projectId)) {
        await socket.leave(projectRoom(projectId));
      }
    }),
  );

  // Presencia: solo de las salas a las que el socket se ha unido (S1).
  socket.on(
    'presence:heartbeat',
    safely(app, 'presence:heartbeat', async (input: unknown) => {
      const parsed = VersionRoomSchema.safeParse(input);
      if (!parsed.success) return logInvalid(app, socket, 'presence:heartbeat');
      if (socket.data.joined.has(parsed.data.versionId)) {
        await presence.heartbeat(parsed.data.versionId, socket);
      }
    }),
  );

  socket.on(
    'presence:select',
    safely(app, 'presence:select', async (input: unknown) => {
      const parsed = PresenceSelectSchema.safeParse(input);
      if (!parsed.success) return logInvalid(app, socket, 'presence:select');
      const { versionId, activityKey } = parsed.data;
      if (!socket.data.joined.has(versionId) || !allowSelect()) return;
      await presence.select(versionId, socket, activityKey);
    }),
  );

  socket.on(
    'disconnect',
    safely(app, 'disconnect', async () => {
      for (const versionId of socket.data.joined.keys()) await presence.leave(versionId, socket);
    }),
  );
}
