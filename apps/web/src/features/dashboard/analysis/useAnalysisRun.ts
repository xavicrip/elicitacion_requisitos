import type { AnalysisRun, DashboardFilters } from '@reqcanvas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '../../../lib/api-client';
import { dashboardApi, dashboardKeys } from '../api';

/** Cada cuánto se consulta un análisis en curso (plan de la 007, ajuste 8); las pruebas lo acortan. */
export const polling = { intervalMs: 3000 };

const active = (run: AnalysisRun | undefined) =>
  run?.status === 'pending' || run?.status === 'running';

/**
 * Análisis del proyecto: el último terminado, el que está en curso (consultado cada 3 s, sin
 * socket) y la acción de lanzar uno con los filtros actuales. Si ya hay uno en curso (409), se
 * sigue ese.
 */
export function useAnalysisRun(projectId: string, enabled: boolean) {
  const client = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const latest = useQuery({
    queryKey: dashboardKeys.latest(projectId),
    queryFn: () => dashboardApi.latest(projectId),
    enabled,
  });
  const current = useQuery({
    queryKey: dashboardKeys.run(runId ?? ''),
    queryFn: () => dashboardApi.run(runId!),
    enabled: Boolean(runId),
    refetchInterval: (query) => (active(query.state.data) ? polling.intervalMs : false),
  });

  const finished = current.data && !active(current.data) ? current.data : undefined;
  useEffect(() => {
    if (!finished) return;
    if (finished.status === 'done') {
      void client.invalidateQueries({ queryKey: dashboardKeys.latest(projectId) });
    }
  }, [finished, client, projectId]);

  const start = useMutation({
    mutationFn: (filters: DashboardFilters) => dashboardApi.start(projectId, filters),
    onMutate: () => setError(''),
    onSuccess: (run) => {
      client.setQueryData(dashboardKeys.run(run.id), run);
      setRunId(run.id);
    },
    onError: (err) => {
      const inProgress = (err as ApiError).body as { runId?: string } | undefined;
      if (err instanceof ApiError && err.code === 'ANALYSIS_IN_PROGRESS' && inProgress?.runId) {
        setRunId(inProgress.runId);
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo lanzar el análisis. Inténtalo de nuevo.',
      );
    },
  });

  const regenerate = useMutation({
    mutationFn: (sourceRunId: string) => dashboardApi.regenerateInsights(sourceRunId),
    onMutate: () => setError(''),
    onSuccess: (run) => {
      client.setQueryData(dashboardKeys.run(run.id), run);
      setRunId(run.id);
    },
    onError: (err) =>
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo regenerar el resumen. Inténtalo de nuevo.',
      ),
  });

  return {
    latest: latest.data ?? null,
    loading: latest.isLoading,
    /** El run lanzado en esta sesión: en curso o recién terminado. */
    current: current.data,
    running: start.isPending || regenerate.isPending || active(current.data),
    error,
    start: (filters: DashboardFilters) => start.mutate(filters),
    /** Regenera solo el resumen de hallazgos del análisis indicado. */
    regenerate: (sourceRunId: string) => regenerate.mutate(sourceRunId),
  };
}
