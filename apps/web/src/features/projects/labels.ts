import type { ProjectStatus, Role, StatusAction } from '@reqcanvas/shared';

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: 'Borrador',
  open: 'Abierto',
  closed: 'Cerrado',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  participant: 'Participante',
};

/** Acción disponible en cada estado (FR-006) y el texto de su botón. */
export const STATUS_ACTION: Record<ProjectStatus, { action: StatusAction; label: string }> = {
  draft: { action: 'open', label: 'Abrir proyecto' },
  open: { action: 'close', label: 'Cerrar proyecto' },
  closed: { action: 'reopen', label: 'Reabrir proyecto' },
};
