import type {
  ActivityCoverage,
  Comment,
  Detail,
  DetailInput,
  Facets,
  HistoryEntry,
  VoteState,
} from '@reqcanvas/shared';
import { apiFetch } from '../../lib/api-client';

export type DetailsQuery = { sort: 'votes' | 'recent' };

/** Detalles de requisitos (contracts/details.openapi.yaml). */
export const detailsApi = {
  list: (diagramId: string, activityKey: string, query: DetailsQuery = { sort: 'votes' }) =>
    apiFetch<Detail[]>(
      `/diagrams/${diagramId}/activities/${activityKey}/details?${new URLSearchParams(query)}`,
    ),
  create: (diagramId: string, activityKey: string, input: DetailInput) =>
    apiFetch<Detail>(`/diagrams/${diagramId}/activities/${activityKey}/details`, {
      method: 'POST',
      body: input,
    }),
  /** `rev` es el que se editó: la API responde 409 con el detalle actual si cambió. */
  update: (id: string, rev: number, input: DetailInput) =>
    apiFetch<Detail>(`/details/${id}`, {
      method: 'PATCH',
      body: input,
      headers: { 'if-match': `"${rev}"` },
    }),
  remove: (id: string) => apiFetch<void>(`/details/${id}`, { method: 'DELETE' }),
  history: (id: string) => apiFetch<HistoryEntry[]>(`/details/${id}/history`),
  facets: (projectId: string) => apiFetch<Facets>(`/projects/${projectId}/details/facets`),
  vote: (id: string, voted: boolean) =>
    apiFetch<VoteState>(`/details/${id}/vote`, { method: voted ? 'PUT' : 'DELETE' }),
  comments: (id: string) => apiFetch<Comment[]>(`/details/${id}/comments`),
  comment: (id: string, text: string) =>
    apiFetch<Comment>(`/details/${id}/comments`, { method: 'POST', body: { text } }),
  editComment: (id: string, text: string) =>
    apiFetch<Comment>(`/comments/${id}`, { method: 'PATCH', body: { text } }),
  removeComment: (id: string) => apiFetch<void>(`/comments/${id}`, { method: 'DELETE' }),
  coverage: (versionId: string) =>
    apiFetch<ActivityCoverage[]>(`/diagram-versions/${versionId}/coverage`),
};

/**
 * Claves de TanStack Query. Todo lo que depende de los detalles empieza por `details`: tras
 * crear, editar, moderar o eliminar se invalida `all` y se refrescan lista y cobertura.
 */
export const detailKeys = {
  all: ['details'] as const,
  coverage: (versionId: string) => ['details', 'coverage', versionId] as const,
  list: (diagramId: string, activityKey: string, query: DetailsQuery) =>
    ['details', diagramId, activityKey, query] as const,
  activity: (diagramId: string, activityKey: string) =>
    ['details', diagramId, activityKey] as const,
  facets: (projectId: string) => ['details-facets', projectId] as const,
  history: (id: string) => ['details-history', id] as const,
  comments: (id: string) => ['details', 'comments', id] as const,
};
