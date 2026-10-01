import { detailPermissions as sharedPermissions } from '@reqcanvas/shared';
import type { DetailPermissions, DetailStatus } from '@reqcanvas/shared';
import type { Member, Project } from '../projects/model.js';

/** Lo que el permiso necesita saber de un detalle. */
type DetailLike = { status: DetailStatus; authorId: { toHexString(): string } };

/** Regla de `@reqcanvas/shared` (research R5 de la 004) con los modelos de `api`. */
export function detailPermissions(
  detail: DetailLike,
  membership: Member,
  project: Pick<Project, 'status'>,
): DetailPermissions {
  return sharedPermissions(
    { status: detail.status, authorId: detail.authorId.toHexString() },
    { userId: membership.userId.toHexString(), role: membership.role },
    // Un proyecto que se está borrando ya no es accesible: cuenta como no abierto.
    project.status === 'deleting' ? 'closed' : project.status,
  );
}
