import type { Member as MemberDto, Role } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { isValidObjectId, Types } from 'mongoose';
import { HttpError } from '../../lib/errors.js';
import { auditService } from '../audit/service.js';
import { usersModel } from '../users/model.js';
import { projectsModel, type Member, type Project } from './model.js';

const lastAdmin = () =>
  new HttpError(409, 'LAST_ADMIN', 'El proyecto necesita al menos un Administrador');
const memberNotFound = () => new HttpError(404, 'NOT_FOUND', 'Miembro no encontrado');

/**
 * Filtro "queda otro Administrador además de `userId`" (research R6). Va dentro de la misma
 * actualización: MongoDB aplica de forma atómica las escrituras sobre un documento, así que ni
 * dos cambios simultáneos pueden dejar el proyecto sin Administradores (FR-010).
 */
const anotherAdmin = (userId: Types.ObjectId) => ({
  members: { $elemMatch: { role: 'admin', userId: { $ne: userId } } },
});

/** Miembros de un proyecto (US3, FR-009, FR-010). */
export function membersService(app: FastifyInstance) {
  const Projects = projectsModel(app.mongo);
  const Users = usersModel(app.mongo);
  const audit = auditService(app.mongo, app.log);

  function findMember(project: Project, userId: string): Member {
    const member = isValidObjectId(userId)
      ? project.members.find((m) => m.userId.equals(userId))
      : undefined;
    if (!member) throw memberNotFound();
    return member;
  }

  async function toDtos(members: Member[]): Promise<MemberDto[]> {
    const users = await Users.find(
      { _id: { $in: members.map((m) => m.userId) } },
      { name: 1, email: 1 },
    ).lean();
    const byId = new Map(users.map((user) => [user._id.toHexString(), user]));
    return members.map((member) => {
      const user = byId.get(member.userId.toHexString());
      return {
        userId: member.userId.toHexString(),
        name: user?.name ?? '(cuenta eliminada)',
        email: user?.email ?? '',
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
      };
    });
  }

  return {
    list: (project: Project) => toDtos(project.members),

    async changeRole(
      project: Project,
      targetId: string,
      role: Role,
      actorId: string,
    ): Promise<MemberDto> {
      const target = findMember(project, targetId);
      if (target.role !== role) {
        const demoting = target.role === 'admin';
        const result = await Projects.updateOne(
          {
            $and: [
              { _id: project._id, status: { $ne: 'deleting' } },
              { 'members.userId': target.userId },
              ...(demoting ? [anotherAdmin(target.userId)] : []),
            ],
          },
          { $set: { 'members.$[m].role': role } },
          { arrayFilters: [{ 'm.userId': target.userId }] },
        );
        if (result.modifiedCount === 0) throw lastAdmin();
        await audit.record('member.role_changed', {
          actorId: new Types.ObjectId(actorId),
          projectId: project._id,
          entity: { type: 'member', id: targetId },
          diff: { role: { from: target.role, to: role } },
        });
      }
      const [dto] = await toDtos([{ ...target, role }]);
      return dto!;
    },

    /** Retirar a otro (solo Administrador) o abandonar el proyecto (cualquier miembro). */
    async remove(
      project: Project,
      actor: Member,
      targetId: string,
      actorId: string,
    ): Promise<void> {
      const self = targetId === actorId;
      if (!self && actor.role !== 'admin') {
        throw new HttpError(
          403,
          'FORBIDDEN',
          'Solo un Administrador del proyecto puede retirar a otros miembros.',
        );
      }
      const target = findMember(project, targetId);
      const result = await Projects.updateOne(
        {
          $and: [
            { _id: project._id, status: { $ne: 'deleting' } },
            { 'members.userId': target.userId },
            ...(target.role === 'admin' ? [anotherAdmin(target.userId)] : []),
          ],
        },
        { $pull: { members: { userId: target.userId } } },
      );
      if (result.modifiedCount === 0) throw lastAdmin();
      // El usuario y lo que lo referencia (auditoría, aportes) se conservan con su autoría.
      await audit.record(self ? 'member.left' : 'member.removed', {
        actorId: new Types.ObjectId(actorId),
        projectId: project._id,
        entity: { type: 'member', id: targetId },
        diff: { role: target.role },
      });
      await app.domainEvents.emit(self ? 'member.left' : 'member.removed', {
        projectId: project._id.toHexString(),
        userId: targetId,
        actorId,
        at: new Date().toISOString(),
      });
    },
  };
}
