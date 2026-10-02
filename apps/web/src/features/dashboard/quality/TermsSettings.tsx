import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { FormError } from '../../../components/form';
import { ApiError } from '../../../lib/api-client';
import { dashboardApi, dashboardKeys } from '../api';

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * Términos propios del proyecto (FR-009): palabras ambiguas que también deben señalarse y
 * palabras vacías que el análisis debe ignorar. Se aplican en el siguiente análisis.
 */
export function TermsSettings({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const ids = { ambiguous: useId(), stopwords: useId() };
  const settings = useQuery({
    queryKey: dashboardKeys.settings(projectId),
    queryFn: () => dashboardApi.settings(projectId),
  });
  const [ambiguous, setAmbiguous] = useState('');
  const [stopwords, setStopwords] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!settings.data) return;
    setAmbiguous(settings.data.extraAmbiguousTerms.join('\n'));
    setStopwords(settings.data.extraStopwords.join('\n'));
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () =>
      dashboardApi.saveSettings(projectId, {
        ...settings.data!,
        extraAmbiguousTerms: lines(ambiguous),
        extraStopwords: lines(stopwords),
      }),
    onMutate: () => {
      setError('');
      setMessage('');
    },
    onSuccess: (saved) => {
      client.setQueryData(dashboardKeys.settings(projectId), saved);
      setMessage('Guardado. Se aplicará en el próximo análisis.');
    },
    onError: (err) => {
      const fields = err instanceof ApiError ? Object.values(err.fields) : [];
      setError(fields[0] ?? (err instanceof ApiError ? err.message : 'No se pudo guardar.'));
    },
  });

  return (
    <details className="rounded border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Términos propios del proyecto
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (settings.data) save.mutate();
        }}
        className="mt-3 space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={ids.ambiguous} className="block text-sm">
              Términos ambiguos (uno por línea)
            </label>
            <textarea
              id={ids.ambiguous}
              rows={4}
              value={ambiguous}
              onChange={(event) => setAmbiguous(event.target.value)}
              className="w-full rounded border px-2 py-1"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={ids.stopwords} className="block text-sm">
              Palabras que el análisis debe ignorar (una por línea)
            </label>
            <textarea
              id={ids.stopwords}
              rows={4}
              value={stopwords}
              onChange={(event) => setStopwords(event.target.value)}
              className="w-full rounded border px-2 py-1"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={!settings.data || save.isPending}
          className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        >
          Guardar términos
        </button>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        <FormError>{error}</FormError>
      </form>
    </details>
  );
}
