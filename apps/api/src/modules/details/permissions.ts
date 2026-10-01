import type { DetailPermissions, DetailStatus } from '@reqcanvas/shared';
import type { Member, Project } from '../projects/model.js';

/** Lo que el permiso necesita saber de un detalle. */
type DetailLike = { status: DetailStatus; authorId: { toHexString(): string } };

/**
 * Permisos de un miembro sobre un detalle (research R5). Con el proyecto no abierto, todo es de
 * solo lectura (FR-013), también para el Administrador.
 */
export function detailPermissions(
  detail: DetailLike,
  membership: Member,
  project: Pick<Project, 'status'>,
): DetailPermissions {
  const open = project.status === 'open';
  const isAdmin = membership.role === 'admin';
  const isAuthor = detail.authorId.toHexString() === membership.userId.toHexString();
  // El autor edita mientras está pendiente; el Administrador, si no está moderado como
  // duplicado o descartado (esos solo se moderan).
  const editable = isAdmin
    ? detail.status === 'pending' || detail.status === 'validated'
    : isAuthor && detail.status === 'pending';
  return {
    canEdit: open && editable,
    canDelete: open && editable,
    canVote: open && !isAuthor && (detail.status === 'pending' || detail.status === 'validated'),
    canModerate: open && isAdmin,
  };
}
