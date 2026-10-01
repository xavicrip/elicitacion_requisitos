import type { Comment as CommentDto, VoteState } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import { HttpError } from '../../lib/errors.js';
import { projectsModel } from '../projects/model.js';
import { commentsModel, type DetailComment } from './models/comment.js';
import { detailsModel, type Detail } from './models/detail.js';
import { votesModel } from './models/vote.js';
import { userNames, userRef } from './names.js';
import type { Viewer } from './service.js';

const isDuplicateKey = (error: unknown) => (error as { code?: number }).code === 11000;
const forbidden = (message: string) => new HttpError(403, 'FORBIDDEN', message);

/** Votos y comentarios de los detalles (FR-008, FR-009; research R4). */
export function interactionsService(app: FastifyInstance) {
  const Details = detailsModel(app.mongo);
  const Votes = votesModel(app.mongo);
  const Comments = commentsModel(app.mongo);
  const Projects = projectsModel(app.mongo);

  const isMe = (id: Types.ObjectId, viewer: Viewer) =>
    id.toHexString() === viewer.membership.userId.toHexString();

  const eventBase = (detail: Pick<Detail, 'projectId' | 'diagramId'>, viewer: Viewer) => ({
    projectId: detail.projectId.toHexString(),
    diagramId: detail.diagramId.toHexString(),
    actorId: viewer.membership.userId.toHexString(),
    at: new Date().toISOString(),
  });

  const touchProject = (projectId: Types.ObjectId) =>
    Projects.updateOne({ _id: projectId }, { $set: { lastActivityAt: new Date() } });

  async function presentComments(comments: DetailComment[], viewer: Viewer): Promise<CommentDto[]> {
    const names = await userNames(
      app,
      comments.map((comment) => comment.authorId),
    );
    const open = viewer.project.status === 'open';
    const isAdmin = viewer.membership.role === 'admin';
    return comments.map((comment) => ({
      id: comment._id.toHexString(),
      detailId: comment.detailId.toHexString(),
      text: comment.text,
      author: userRef(names, comment.authorId),
      createdAt: comment.createdAt.toISOString(),
      editedAt: comment.editedAt ? comment.editedAt.toISOString() : null,
      permissions: {
        canEdit: open && isMe(comment.authorId, viewer),
        canDelete: open && (isMe(comment.authorId, viewer) || isAdmin),
      },
    }));
  }

  const detailOf = async (comment: DetailComment) =>
    (await Details.findById(comment.detailId, { projectId: 1, diagramId: 1 }).lean<
      Pick<Detail, 'projectId' | 'diagramId'>
    >())!;

  /** Aplica el cambio de `voteCount` (si lo hubo) y emite `vote.changed`. */
  async function afterVote(detail: Detail, viewer: Viewer, delta: number, voted: boolean) {
    const updated = delta
      ? await Details.findByIdAndUpdate(detail._id, { $inc: { voteCount: delta } }, { new: true })
      : await Details.findById(detail._id);
    const voteCount = updated?.voteCount ?? 0;
    if (delta) {
      await app.detailEvents.emit('vote.changed', {
        ...eventBase(detail, viewer),
        detailId: detail._id.toHexString(),
        voteCount,
        userId: viewer.membership.userId.toHexString(),
        voted,
      });
    }
    return { voteCount, votedByMe: voted };
  }

  return {
    loadComment: (id: string) => Comments.findById(id).lean<DetailComment>(),

    /**
     * Voto idempotente: el índice único `{detailId, userId}` decide, y `voteCount` solo sube si
     * la inserción tuvo éxito, también con votos simultáneos.
     */
    async vote(detail: Detail, viewer: Viewer): Promise<VoteState> {
      if (isMe(detail.authorId, viewer)) throw forbidden('No puedes votar tu propio requisito.');
      if (detail.status !== 'pending' && detail.status !== 'validated') {
        throw new HttpError(
          409,
          'VOTE_NOT_ALLOWED',
          'Solo se votan requisitos pendientes o validados.',
        );
      }
      let changed = true;
      try {
        await Votes.create({
          detailId: detail._id,
          userId: viewer.membership.userId,
          projectId: detail.projectId,
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        changed = false;
      }
      return afterVote(detail, viewer, changed ? 1 : 0, true);
    },

    /** Retirar el voto también es idempotente, y se permite en cualquier estado. */
    async unvote(detail: Detail, viewer: Viewer): Promise<VoteState> {
      const { deletedCount } = await Votes.deleteOne({
        detailId: detail._id,
        userId: viewer.membership.userId,
      });
      return afterVote(detail, viewer, deletedCount ? -1 : 0, false);
    },

    async listComments(detail: Detail, viewer: Viewer) {
      const comments = await Comments.find({ detailId: detail._id })
        .sort({ createdAt: 1, _id: 1 })
        .lean<DetailComment[]>();
      return presentComments(comments, viewer);
    },

    async comment(detail: Detail, text: string, viewer: Viewer) {
      const created = await Comments.create({
        detailId: detail._id,
        projectId: detail.projectId,
        authorId: viewer.membership.userId,
        text,
      });
      await Details.updateOne({ _id: detail._id }, { $inc: { commentCount: 1 } });
      const [comment] = await presentComments([created.toObject()], viewer);
      await touchProject(detail.projectId);
      await app.detailEvents.emit('comment.created', {
        ...eventBase(detail, viewer),
        comment: comment!,
      });
      return comment!;
    },

    /** Solo su autor edita un comentario. */
    async editComment(comment: DetailComment, text: string, viewer: Viewer) {
      if (!isMe(comment.authorId, viewer)) {
        throw forbidden('Solo puedes editar tus propios comentarios.');
      }
      const updated = await Comments.findByIdAndUpdate(
        comment._id,
        { $set: { text, editedAt: new Date() } },
        { new: true, runValidators: true },
      ).lean<DetailComment>();
      const [presented] = await presentComments([updated!], viewer);
      await app.detailEvents.emit('comment.updated', {
        ...eventBase(await detailOf(comment), viewer),
        comment: presented!,
      });
      return presented!;
    },

    /** Lo elimina su autor o un Administrador. */
    async removeComment(comment: DetailComment, viewer: Viewer) {
      if (!isMe(comment.authorId, viewer) && viewer.membership.role !== 'admin') {
        throw forbidden('Solo puedes eliminar tus propios comentarios.');
      }
      const { deletedCount } = await Comments.deleteOne({ _id: comment._id });
      if (!deletedCount) return;
      await Details.updateOne({ _id: comment.detailId }, { $inc: { commentCount: -1 } });
      await app.detailEvents.emit('comment.deleted', {
        ...eventBase(await detailOf(comment), viewer),
        commentId: comment._id.toHexString(),
        detailId: comment.detailId.toHexString(),
      });
    },
  };
}
