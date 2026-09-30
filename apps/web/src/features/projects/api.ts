import type {
  Invitation,
  InvitationCreated,
  Member,
  Project,
  ProjectInput,
  ProjectSummary,
  Role,
  StatusAction,
} from '@reqcanvas/shared';
import { apiFetch } from '../../lib/api-client';

/** Llamadas a /api/projects (contracts/auth-projects.openapi.yaml). */
export const projectsApi = {
  list: () => apiFetch<ProjectSummary[]>('/projects'),
  get: (id: string) => apiFetch<Project>(`/projects/${id}`),
  create: (input: ProjectInput) => apiFetch<Project>('/projects', { method: 'POST', body: input }),
  update: (id: string, input: ProjectInput) =>
    apiFetch<Project>(`/projects/${id}`, { method: 'PATCH', body: input }),
  changeStatus: (id: string, action: StatusAction) =>
    apiFetch<Project>(`/projects/${id}/status`, { method: 'POST', body: { action } }),
  remove: (id: string, confirmName: string) =>
    apiFetch<void>(`/projects/${id}`, { method: 'DELETE', body: { confirmName } }),
};

/** Miembros e invitaciones de un proyecto (US3). */
export const membersApi = {
  list: (projectId: string) => apiFetch<Member[]>(`/projects/${projectId}/members`),
  changeRole: (projectId: string, userId: string, role: Role) =>
    apiFetch<Member>(`/projects/${projectId}/members/${userId}`, {
      method: 'PATCH',
      body: { role },
    }),
  remove: (projectId: string, userId: string) =>
    apiFetch<void>(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),
  invitations: (projectId: string) => apiFetch<Invitation[]>(`/projects/${projectId}/invitations`),
  invite: (projectId: string) =>
    apiFetch<InvitationCreated>(`/projects/${projectId}/invitations`, { method: 'POST' }),
  revoke: (projectId: string, invitationId: string) =>
    apiFetch<void>(`/projects/${projectId}/invitations/${invitationId}`, { method: 'DELETE' }),
};

export const projectKeys = {
  list: ['projects'] as const,
  detail: (id: string) => ['projects', id] as const,
  members: (id: string) => ['projects', id, 'members'] as const,
  invitations: (id: string) => ['projects', id, 'invitations'] as const,
};
