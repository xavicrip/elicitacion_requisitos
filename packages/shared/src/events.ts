import type { Comment, Detail, DetailStatus } from './details';

/**
 * Eventos de dominio de los detalles (specs/004-detalles-requisitos/contracts/domain-events.md).
 * Se emiten después de confirmar la escritura; en la 004 los consume la auditoría y la 005 los
 * retransmite por Socket.IO. Sin datos calculados por usuario (`permissions`, `votedByMe`).
 */
type Base = { projectId: string; diagramId: string; actorId: string; at: string };

export type PublicDetail = Omit<Detail, 'permissions' | 'votedByMe'>;
export type PublicComment = Omit<Comment, 'permissions'>;

export type DetailEvents = {
  'detail.created': Base & { detail: PublicDetail };
  'detail.updated': Base & { detail: PublicDetail; rev: number };
  'detail.deleted': Base & { detailId: string; activityKey: string };
  'detail.status_changed': Base & {
    detailId: string;
    activityKey: string;
    status: DetailStatus;
    duplicateOf?: string;
    discardReason?: string;
  };
  'detail.reassigned': Base & {
    detailId: string;
    from: { diagramId: string; activityKey: string };
    to: { diagramId: string; activityKey: string };
  };
  'vote.changed': Base & { detailId: string; voteCount: number; userId: string; voted: boolean };
  'comment.created': Base & { comment: PublicComment };
  'comment.updated': Base & { comment: PublicComment };
  'comment.deleted': Base & { commentId: string; detailId: string };
};

export type DetailEventName = keyof DetailEvents;
