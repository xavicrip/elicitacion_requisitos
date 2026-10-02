import type {
  AnalysisRun,
  AnalysisSettings,
  AnalysisSettingsInput,
  DashboardFilters,
  DescriptiveDashboard,
  DuplicateDecision,
  DuplicateDecisionInput,
} from '@reqcanvas/shared';
import { ApiError, apiFetch } from '../../lib/api-client';

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
  /** Último análisis terminado, con resultados; `null` si aún no hay ninguno. */
  latest: async (projectId: string): Promise<AnalysisRun | null> => {
    try {
      return await apiFetch<AnalysisRun>(`/projects/${projectId}/analysis-runs/latest`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  run: (runId: string) => apiFetch<AnalysisRun>(`/analysis-runs/${runId}`),
  start: (projectId: string, filters: DashboardFilters) =>
    apiFetch<AnalysisRun>(`/projects/${projectId}/analysis-runs`, {
      method: 'POST',
      body: { filters },
    }),
  /** Valora un insight; los marcados como no útiles se ocultan (US5-3). */
  insightFeedback: (runId: string, insightId: string, useful: boolean) =>
    apiFetch<void>(`/analysis-runs/${runId}/insights/${insightId}/feedback`, {
      method: 'POST',
      body: { useful },
    }),
  /** Relanza solo el resumen sobre los resultados de un análisis; devuelve el run nuevo. */
  regenerateInsights: (runId: string) =>
    apiFetch<AnalysisRun>(`/analysis-runs/${runId}/insights/regenerate`, { method: 'POST' }),
  decideDuplicate: (projectId: string, input: DuplicateDecisionInput) =>
    apiFetch<DuplicateDecision>(`/projects/${projectId}/duplicate-decisions`, {
      method: 'POST',
      body: input,
    }),
  settings: (projectId: string) =>
    apiFetch<AnalysisSettings>(`/projects/${projectId}/analysis-settings`),
  saveSettings: (projectId: string, input: AnalysisSettingsInput) =>
    apiFetch<AnalysisSettings>(`/projects/${projectId}/analysis-settings`, {
      method: 'PUT',
      body: input,
    }),
};

export const dashboardKeys = {
  descriptive: (projectId: string, filters: DashboardFilters) =>
    ['projects', projectId, 'dashboard', 'descriptive', filters] as const,
  latest: (projectId: string) => ['projects', projectId, 'analysis', 'latest'] as const,
  run: (runId: string) => ['analysis-runs', runId] as const,
  settings: (projectId: string) => ['projects', projectId, 'analysis', 'settings'] as const,
};
