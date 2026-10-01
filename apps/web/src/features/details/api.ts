import type { Detail, DetailInput, Facets } from '@reqcanvas/shared';
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
  facets: (projectId: string) => apiFetch<Facets>(`/projects/${projectId}/details/facets`),
};

export const detailKeys = {
  all: ['details'] as const,
  list: (diagramId: string, activityKey: string, query: DetailsQuery) =>
    ['details', diagramId, activityKey, query] as const,
  activity: (diagramId: string, activityKey: string) =>
    ['details', diagramId, activityKey] as const,
  facets: (projectId: string) => ['details-facets', projectId] as const,
};
