import type { AnalysisResults, DuplicateDecisionInput } from '@reqcanvas/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormError } from '../../../components/form';
import { ApiError } from '../../../lib/api-client';
import { dashboardApi, dashboardKeys } from '../api';
import { DetailSnippet, type Lookup } from '../text/lookup';

type Pairs = NonNullable<AnalysisResults['duplicates']>;
const percent = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 0 });

function PairCard({ pair, lookup }: { pair: Pairs[number]; lookup: Lookup }) {
  const client = useQueryClient();
  const [first, second] = pair.pair;
  const [keep, setKeep] = useState(first);
  const [error, setError] = useState('');
  const decide = useMutation({
    mutationFn: (input: DuplicateDecisionInput) =>
      dashboardApi.decideDuplicate(lookup.projectId, input),
    onMutate: () => setError(''),
    onSuccess: () => client.invalidateQueries({ queryKey: dashboardKeys.latest(lookup.projectId) }),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar la decisión.'),
  });
  const name = `keep-${first}-${second}`;
  return (
    <li aria-label="Posible duplicado" className="space-y-2 rounded border p-3 text-sm">
      <p className="font-semibold">Similitud: {percent.format(pair.similarity)}</p>
      <fieldset className="space-y-1">
        <legend className="text-gray-600">Si son duplicados, ¿cuál se conserva?</legend>
        {[first, second].map((id) => (
          <label key={id} className="flex items-start gap-2">
            <input
              type="radio"
              name={name}
              checked={keep === id}
              onChange={() => setKeep(id)}
              className="mt-1"
            />
            <DetailSnippet id={id} lookup={lookup} />
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={decide.isPending}
          onClick={() =>
            decide.mutate({
              pair: pair.pair,
              decision: 'confirmed',
              keep,
              similarity: pair.similarity,
            })
          }
          className="rounded border px-3 py-1 disabled:opacity-50"
        >
          Confirmar duplicado
        </button>
        <button
          type="button"
          disabled={decide.isPending}
          onClick={() =>
            decide.mutate({ pair: pair.pair, decision: 'rejected', similarity: pair.similarity })
          }
          className="rounded border px-3 py-1 disabled:opacity-50"
        >
          No son duplicados
        </button>
      </div>
      <FormError>{error}</FormError>
    </li>
  );
}

/**
 * Pares de posibles duplicados (US3): son propuestas. Confirmar marca el otro detalle como
 * duplicado del que se conserva (moderación de la 004); rechazar evita que vuelva a proponerse.
 */
export function DuplicatePairs({ pairs, lookup }: { pairs: Pairs; lookup: Lookup }) {
  if (pairs.length === 0) return <p>No hay posibles duplicados pendientes de revisar.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        {pairs.length === 1
          ? '1 par de requisitos parece decir lo mismo.'
          : `${pairs.length} pares de requisitos parecen decir lo mismo.`}{' '}
        Nada cambia hasta que lo confirmes.
      </p>
      <ul aria-label="Posibles duplicados" className="space-y-2">
        {pairs.map((pair) => (
          <PairCard key={pair.pair.join('|')} pair={pair} lookup={lookup} />
        ))}
      </ul>
    </div>
  );
}
