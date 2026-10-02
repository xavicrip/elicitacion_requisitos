import type { DashboardFilters, DescriptiveDashboard } from '@reqcanvas/shared';
import { apiFetch } from '../../lib/api-client';

/** Filtros por defecto del dashboard (FR-003): detalles pendientes y validados. */
export const DEFAULT_FILTERS: DashboardFilters = {
  diagramIds: null,
  from: null,
  to: null,
  types: null,
  statuses: ['pending', 'validated'],
};

/** Query de los filtros (`diagramId`, `type` y `status` repetibles); los de por defecto no se envían. */
export function filtersQuery(filters: DashboardFilters): string {
  const params = new URLSearchParams();
  for (const id of filters.diagramIds ?? []) params.append('diagramId', id);
  for (const type of filters.types ?? []) params.append('type', type);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const defaults = DEFAULT_FILTERS.statuses;
  const same =
    filters.statuses.length === defaults.length &&
    defaults.every((status) => filters.statuses.includes(status));
  if (!same) for (const status of filters.statuses) params.append('status', status);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Dashboard analítico (contracts/dashboard.openapi.yaml). */
export const dashboardApi = {
  descriptive: (projectId: string, filters: DashboardFilters) =>
    apiFetch<DescriptiveDashboard>(
      `/projects/${projectId}/dashboard/descriptive${filtersQuery(filters)}`,
    ),
};

export const dashboardKeys = {
  descriptive: (projectId: string, filters: DashboardFilters) =>
    ['projects', projectId, 'dashboard', 'descriptive', filters] as const,
};
