import { z } from 'zod';

/** Rol por proyecto (FR-007). */
export const RoleSchema = z.enum(['admin', 'participant']);

/**
 * Estado visible de un proyecto (FR-006). `deleting` es interno de `api` y nunca se devuelve:
 * un proyecto en borrado responde 404.
 */
export const ProjectStatusSchema = z.enum(['draft', 'open', 'closed']);

/** Acciones de POST /projects/:id/status. */
export const StatusActionSchema = z.enum(['open', 'close', 'reopen']);

/** Cuerpo de POST y PATCH /projects (FR-005). */
export const ProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).optional(),
});

/** Elemento de "Mis proyectos" (FR-012). */
export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: ProjectStatusSchema,
  myRole: RoleSchema,
  lastActivityAt: z.iso.datetime(),
});

export const ProjectSchema = ProjectSummarySchema.extend({
  description: z.string().optional(),
  memberCount: z.number().int().min(1).optional(),
  createdAt: z.iso.datetime().optional(),
});

export const MemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: RoleSchema,
  joinedAt: z.iso.datetime(),
});

export const InvitationStatusSchema = z.enum(['active', 'expired', 'revoked']);

/** Invitación tal como la lista el Administrador. El token solo se devuelve al crearla. */
export const InvitationSchema = z.object({
  id: z.string(),
  status: InvitationStatusSchema,
  expiresAt: z.iso.datetime(),
  uses: z.number().int().min(0),
});

/** Respuesta de POST /projects/:id/invitations: la única vez que se devuelve el token (en la URL). */
export const InvitationCreatedSchema = InvitationSchema.extend({ url: z.url() });

/** Vista previa pública de una invitación válida (GET /invitations/:token). */
export const InvitationPreviewSchema = z.object({ projectName: z.string() });

/** Cuerpo de PATCH /projects/:id/members/:userId. */
export const RoleChangeSchema = z.object({ role: RoleSchema });

export type Role = z.infer<typeof RoleSchema>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type StatusAction = z.infer<typeof StatusActionSchema>;
export type ProjectInput = z.infer<typeof ProjectInputSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;
export type Invitation = z.infer<typeof InvitationSchema>;
export type InvitationCreated = z.infer<typeof InvitationCreatedSchema>;
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;

const TRANSITIONS: Record<ProjectStatus, Partial<Record<StatusAction, ProjectStatus>>> = {
  draft: { open: 'open' },
  open: { close: 'closed' },
  closed: { reopen: 'open' },
};

/** Estado resultante de aplicar `action`, o `null` si la transición no es válida. */
export function nextStatus(from: ProjectStatus, action: StatusAction): ProjectStatus | null {
  return TRANSITIONS[from][action] ?? null;
}
