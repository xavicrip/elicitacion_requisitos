import type { AnalysisRun } from '@reqcanvas/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormError } from '../../../components/form';
import { ApiError } from '../../../lib/api-client';
import { useFlags } from '../../../lib/flags';
import { dashboardApi, dashboardKeys } from '../api';
import type { Lookup } from '../text/lookup';
import { EvidenceDrawer } from './EvidenceDrawer';

/**
 * Resumen de hallazgos en lenguaje natural (US5): cada insight con su recomendación y el acceso
 * a los datos que lo sustentan. El Administrador puede regenerarlo o marcar uno como no útil.
 * Si el servicio no está disponible, el resto del dashboard sigue funcionando.
 */
export function InsightsPanel({
  run,
  lookup,
  running,
  onRegenerate,
}: {
  run: AnalysisRun;
  lookup: Lookup;
  running: boolean;
  onRegenerate: () => void;
}) {
  const client = useQueryClient();
  const { flags } = useFlags();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const results = run.results!;
  const insights = results.insights ?? [];
  const stage = run.stages.insights;
  const dismiss = useMutation({
    mutationFn: (insightId: string) => dashboardApi.insightFeedback(run.id, insightId, false),
    onMutate: () => setError(''),
    onSuccess: () => client.invalidateQueries({ queryKey: dashboardKeys.latest(run.projectId) }),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar la valoración.'),
  });

  const regenerate = flags.insights && (
    <button
      type="button"
      onClick={onRegenerate}
      disabled={running}
      className="rounded border px-3 py-1 text-sm disabled:opacity-50"
    >
      {insights.length > 0 ? 'Regenerar resumen' : 'Generar resumen'}
    </button>
  );

  if (stage?.status !== 'done') {
    return (
      <div className="space-y-2">
        <p role="note" className="rounded bg-gray-50 p-3 text-sm">
          {stage?.status === 'failed'
            ? 'El resumen no está disponible: no se pudo generar esta vez. El resto del análisis está completo.'
            : 'El resumen no está disponible en este entorno. El resto del análisis está completo.'}
        </p>
        {regenerate}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          Redactado por un modelo de lenguaje a partir de los resultados; cada hallazgo indica los
          datos en los que se basa.
        </p>
        {regenerate}
      </div>
      {results.insightsFewerThanExpected && (
        <p role="note" className="rounded bg-gray-50 p-3 text-sm">
          Solo se muestran los hallazgos que se pudieron comprobar con los datos.
        </p>
      )}
      <FormError>{error}</FormError>
      {insights.length === 0 ? (
        <p>No quedan hallazgos que mostrar.</p>
      ) : (
        <ol aria-label="Hallazgos" className="space-y-2">
          {insights.map((insight) => (
            <li key={insight.id} className="space-y-2 rounded border p-3">
              <h3 className="font-semibold">{insight.title}</h3>
              <p>{insight.statement}</p>
              {insight.recommendation && (
                <p className="text-sm">
                  <span className="font-medium">Recomendación:</span> {insight.recommendation}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-expanded={open === insight.id}
                  onClick={() => setOpen(open === insight.id ? null : insight.id)}
                  className="rounded border px-3 py-1 text-sm"
                >
                  Ver los datos ({insight.evidence.length})
                </button>
                <button
                  type="button"
                  onClick={() => dismiss.mutate(insight.id)}
                  disabled={dismiss.isPending}
                  className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                >
                  No útil
                </button>
              </div>
              {open === insight.id && (
                <EvidenceDrawer insight={insight} results={results} lookup={lookup} />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
