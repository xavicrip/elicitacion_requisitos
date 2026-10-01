import type { Comment, Detail, DetailStatus } from './details';
import type { ProjectStatus } from './projects';

/**
 * Eventos de dominio de los detalles (specs/004-detalles-requisitos/contracts/domain-events.md).
 * Se emiten después de confirmar la escritura; los consume la auditoría y la 005 los
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

/** Nombres de los eventos de detalles, para distinguirlos en tiempo de ejecución. */
export const DETAIL_EVENTS = [
  'detail.created',
  'detail.updated',
  'detail.deleted',
  'detail.status_changed',
  'detail.reassigned',
  'vote.changed',
  'comment.created',
  'comment.updated',
  'comment.deleted',
] as const satisfies readonly DetailEventName[];

/**
 * Eventos de diagramas, proyectos y miembros (plan de la 005, ajuste 4): la 005 los usa para
 * avisar de una versión publicada y para revocar el acceso o pasar a solo lectura al instante.
 */
type ProjectBase = { projectId: string; actorId: string; at: string };

export type ProjectEvents = {
  'diagram.published': ProjectBase & { diagramId: string; versionId: string };
  'project.status_changed': ProjectBase & { from: ProjectStatus; to: ProjectStatus };
  'member.removed': ProjectBase & { userId: string };
  'member.left': ProjectBase & { userId: string };
  'project.deleted': ProjectBase;
};

export type DomainEvents = DetailEvents & ProjectEvents;
export type DomainEventName = keyof DomainEvents;
