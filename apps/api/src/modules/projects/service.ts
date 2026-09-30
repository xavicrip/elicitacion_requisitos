import {
  nextStatus,
  type Project as ProjectDto,
  type ProjectInput,
  type ProjectSummary,
  type StatusAction,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { HttpError } from '../../lib/errors.js';
import { auditService } from '../audit/service.js';
import { projectsModel, type Member, type Project } from './model.js';

const ACTION_LABEL: Record<StatusAction, string> = {
  open: 'abrir',
  close: 'cerrar',
  reopen: 'reabrir',
};
const STATUS_LABEL = { draft: 'borrador', open: 'abierto', closed: 'cerrado' } as const;

export function toProjectDto(project: Project, membership: Member): ProjectDto {
  return {
    id: project._id.toHexString(),
    name: project.name,
    description: project.description,
    status: project.status as ProjectDto['status'],
    myRole: membership.role,
    lastActivityAt: project.lastActivityAt.toISOString(),
    memberCount: project.members.length,
    createdAt: project.createdAt.toISOString(),
  };
}

/** Proyectos de levantamiento (US2): crear, listar, editar y cambiar de estado. */
export function projectsService(app: FastifyInstance) {
  const Projects = projectsModel(app.mongo);
  const audit = auditService(app.mongo, app.log);

  return {
    async create(userId: string, input: ProjectInput): Promise<ProjectDto> {
      const owner = new Types.ObjectId(userId);
      const membership: Member = { userId: owner, role: 'admin', joinedAt: new Date() };
      const project = await Projects.create({
        name: input.name,
        description: input.description ?? '',
        ownerId: owner,
        members: [membership],
      });
      await audit.record('project.created', {
        actorId: owner,
        projectId: project._id,
        entity: { type: 'project', id: project._id.toHexString() },
      });
      return toProjectDto(project.toObject(), membership);
    },

    /** "Mis proyectos" (FR-012): por última actividad, con el rol del usuario en cada uno. */
    async list(userId: string): Promise<ProjectSummary[]> {
      const uid = new Types.ObjectId(userId);
      const projects = await Projects.find(
        { 'members.userId': uid, status: { $ne: 'deleting' } },
        { name: 1, status: 1, lastActivityAt: 1, members: { $elemMatch: { userId: uid } } },
      )
        .sort({ lastActivityAt: -1 })
        .lean<Array<Pick<Project, '_id' | 'name' | 'status' | 'lastActivityAt' | 'members'>>>();
      return projects.map((project) => ({
        id: project._id.toHexString(),
        name: project.name,
        status: project.status as ProjectSummary['status'],
        myRole: project.members[0]!.role,
        lastActivityAt: project.lastActivityAt.toISOString(),
      }));
    },

    async update(
      project: Project,
      membership: Member,
      input: ProjectInput,
      actorId: string,
    ): Promise<ProjectDto> {
      const description = input.description ?? project.description;
      const updated = await Projects.findOneAndUpdate(
        { _id: project._id, status: { $ne: 'deleting' } },
        { $set: { name: input.name, description, lastActivityAt: new Date() } },
        { new: true },
      ).lean<Project>();
      if (!updated) throw new HttpError(404, 'NOT_FOUND', 'Proyecto no encontrado');

      const diff: Record<string, { from: string; to: string }> = {};
      if (project.name !== updated.name) diff.name = { from: project.name, to: updated.name };
      if (project.description !== updated.description) {
        diff.description = { from: project.description, to: updated.description };
      }
      if (Object.keys(diff).length > 0) {
        await audit.record('project.updated', {
          actorId: new Types.ObjectId(actorId),
          projectId: project._id,
          entity: { type: 'project', id: project._id.toHexString() },
          diff,
        });
      }
      return toProjectDto(updated, membership);
    },

    /**
     * Borrado (US2 escenario 4): exige escribir el nombre exacto, marca el proyecto como
     * `deleting` (404 para todos desde ese momento) y encola el borrado en cascada.
     */
    async requestDeletion(project: Project, confirmName: string, actorId: string): Promise<void> {
      if (confirmName !== project.name) {
        throw new HttpError(
          400,
          'CONFIRMATION_MISMATCH',
          'Escribe el nombre exacto del proyecto para confirmar.',
        );
      }
      const marked = await Projects.updateOne(
        { _id: project._id, status: { $ne: 'deleting' } },
        { $set: { status: 'deleting', deletion: { status: 'pending', attempts: 0 } } },
      );
      if (marked.modifiedCount === 0) {
        throw new HttpError(404, 'NOT_FOUND', 'Proyecto no encontrado');
      }
      await audit.record('project.deletion_requested', {
        actorId: new Types.ObjectId(actorId),
        projectId: project._id,
        entity: { type: 'project', id: project._id.toHexString() },
        diff: { name: project.name },
      });
      await app.enqueueProjectDeletion(project._id.toHexString());
    },

    /** Ciclo borrador → abierto → cerrado → abierto (FR-006), con auditoría (FR-013). */
    async changeStatus(
      project: Project,
      membership: Member,
      action: StatusAction,
      actorId: string,
    ): Promise<ProjectDto> {
      const from = project.status as ProjectDto['status'];
      const to = nextStatus(from, action);
      const invalid = () =>
        new HttpError(
          409,
          'INVALID_TRANSITION',
          `No se puede ${ACTION_LABEL[action]} un proyecto en estado ${STATUS_LABEL[from] ?? from}.`,
        );
      if (!to) throw invalid();

      // Condicionado al estado leído: dos cambios simultáneos no se pisan.
      const updated = await Projects.findOneAndUpdate(
        { _id: project._id, status: from },
        { $set: { status: to, lastActivityAt: new Date() } },
        { new: true },
      ).lean<Project>();
      if (!updated) throw invalid();

      await audit.record('project.status_changed', {
        actorId: new Types.ObjectId(actorId),
        projectId: project._id,
        entity: { type: 'project', id: project._id.toHexString() },
        diff: { status: { from, to } },
      });
      return toProjectDto(updated, membership);
    },
  };
}
