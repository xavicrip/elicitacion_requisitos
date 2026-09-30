import type {
  Invitation as InvitationDto,
  InvitationCreated,
  InvitationPreview,
  ProjectSummary,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { isValidObjectId, Types } from 'mongoose';
import { HttpError } from '../../lib/errors.js';
import { auditService } from '../audit/service.js';
import { hashToken, newRefreshToken } from '../auth/tokens.js';
import { projectsModel, type Project } from '../projects/model.js';
import { invitationsModel, type Invitation } from './model.js';

const VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

const invalid = () => new HttpError(410, 'INVITATION_INVALID', 'Esta invitación ya no es válida');

function statusOf(invitation: Invitation, now = new Date()): InvitationDto['status'] {
  if (invitation.revokedAt) return 'revoked';
  return invitation.expiresAt > now ? 'active' : 'expired';
}

function toDto(invitation: Invitation): InvitationDto {
  return {
    id: invitation._id.toHexString(),
    status: statusOf(invitation),
    expiresAt: invitation.expiresAt.toISOString(),
    uses: invitation.uses,
  };
}

/**
 * Invitaciones por enlace multiuso (FR-008, research R8): token de 32 bytes que solo viaja en
 * la URL al crearla; en la base de datos se guarda su SHA-256. Caducan a los 7 días.
 */
export function invitationsService(app: FastifyInstance, appBaseUrl: string) {
  const Invitations = invitationsModel(app.mongo);
  const Projects = projectsModel(app.mongo);
  const audit = auditService(app.mongo, app.log);
  const baseUrl = appBaseUrl.replace(/\/+$/, '');

  /** Invitación válida y su proyecto; si no, 410 (sin distinguir el motivo). */
  async function findValid(token: string): Promise<{ invitation: Invitation; project: Project }> {
    const invitation = await Invitations.findOne({
      tokenHash: hashToken(token),
    }).lean<Invitation>();
    if (!invitation || statusOf(invitation) !== 'active') throw invalid();
    const project = await Projects.findOne({
      _id: invitation.projectId,
      status: { $ne: 'deleting' },
    }).lean<Project>();
    if (!project) throw invalid();
    return { invitation, project };
  }

  return {
    async create(project: Project, actorId: string): Promise<InvitationCreated> {
      const { token, hash } = newRefreshToken();
      const invitation = await Invitations.create({
        projectId: project._id,
        tokenHash: hash,
        createdBy: new Types.ObjectId(actorId),
        expiresAt: new Date(Date.now() + VALIDITY_MS),
      });
      await audit.record('invitation.created', {
        actorId: new Types.ObjectId(actorId),
        projectId: project._id,
        entity: { type: 'invitation', id: invitation._id.toHexString() },
        diff: { expiresAt: invitation.expiresAt.toISOString() },
      });
      return { ...toDto(invitation.toObject()), url: `${baseUrl}/invitacion/${token}` };
    },

    async list(project: Project): Promise<InvitationDto[]> {
      const invitations = await Invitations.find({ projectId: project._id })
        .sort({ createdAt: -1 })
        .lean<Invitation[]>();
      return invitations.map(toDto);
    },

    async revoke(project: Project, invitationId: string, actorId: string): Promise<void> {
      const notFound = () => new HttpError(404, 'NOT_FOUND', 'Invitación no encontrada');
      if (!isValidObjectId(invitationId)) throw notFound();
      const invitation = await Invitations.exists({ _id: invitationId, projectId: project._id });
      if (!invitation) throw notFound();
      // Condicionada a no estar revocada: revocar dos veces no cambia la fecha ni se audita dos.
      const revoked = await Invitations.updateOne(
        { _id: invitationId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      if (revoked.modifiedCount === 1) {
        await audit.record('invitation.revoked', {
          actorId: new Types.ObjectId(actorId),
          projectId: project._id,
          entity: { type: 'invitation', id: invitationId },
        });
      }
    },

    async preview(token: string): Promise<InvitationPreview> {
      const { project } = await findValid(token);
      return { projectName: project.name };
    },

    /** Unirse como Participante (US3 escenario 2). Idempotente: no duplica ni cambia el rol. */
    async accept(token: string, userId: string): Promise<ProjectSummary> {
      const { invitation, project } = await findValid(token);
      const uid = new Types.ObjectId(userId);
      const joined = await Projects.updateOne(
        { _id: project._id, status: { $ne: 'deleting' }, 'members.userId': { $ne: uid } },
        { $push: { members: { userId: uid, role: 'participant', joinedAt: new Date() } } },
      );
      if (joined.modifiedCount === 1) {
        await Invitations.updateOne({ _id: invitation._id }, { $inc: { uses: 1 } });
        await audit.record('member.joined', {
          actorId: uid,
          projectId: project._id,
          entity: { type: 'member', id: userId },
          diff: { invitation: invitation._id.toHexString() },
        });
      }
      const current = await Projects.findById(project._id).lean<Project>();
      const membership = current?.members.find((m) => m.userId.equals(uid));
      if (!current || !membership) throw invalid();
      return {
        id: current._id.toHexString(),
        name: current.name,
        status: current.status as ProjectSummary['status'],
        myRole: membership.role,
        lastActivityAt: current.lastActivityAt.toISOString(),
      };
    },
  };
}
