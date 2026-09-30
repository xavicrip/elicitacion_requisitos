import type { Project, ProjectInput, ProjectSummary, StatusAction } from '@reqcanvas/shared';
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

export const projectKeys = {
  list: ['projects'] as const,
  detail: (id: string) => ['projects', id] as const,
};
