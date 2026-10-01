import { detailSummary, type Detail, type StatusChange } from '@reqcanvas/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { FormError } from '../../components/form';
import { ApiError } from '../../lib/api-client';
import { detailKeys, detailsApi } from './api';

/**
 * Moderación de un detalle por el Administrador (FR-010): validar, marcar como duplicado de
 * otro (de la misma actividad) o descartar con motivo, y volver a pendiente.
 */
export function ModerationMenu({ detail, siblings }: { detail: Detail; siblings: Detail[] }) {
  const queryClient = useQueryClient();
  const originalId = useId();
  const reasonId = useId();
  const [mode, setMode] = useState<'duplicate' | 'discard' | null>(null);
  const [original, setOriginal] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const candidates = siblings.filter(
    (other) => other.id !== detail.id && other.status !== 'duplicate',
  );

  const moderate = useMutation({
    mutationFn: (change: StatusChange) => detailsApi.moderate(detail.id, change),
    onSuccess: async () => {
      setMode(null);
      setError('');
      await queryClient.invalidateQueries({ queryKey: detailKeys.all });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo moderar el requisito.'),
  });

  const open = detail.status === 'pending' || detail.status === 'validated';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 text-xs">
        {detail.status === 'pending' && (
          <button
            type="button"
            onClick={() => moderate.mutate({ status: 'validated' })}
            className="rounded border border-green-700 px-2 py-1 text-green-800"
          >
            Validar
          </button>
        )}
        {detail.status !== 'pending' && (
          <button
            type="button"
            onClick={() => moderate.mutate({ status: 'pending' })}
            className="rounded border px-2 py-1"
          >
            Volver a pendiente
          </button>
        )}
        {open && (
          <>
            <button
              type="button"
              onClick={() => setMode('duplicate')}
              className="rounded border px-2 py-1"
            >
              Marcar como duplicado
            </button>
            <button
              type="button"
              onClick={() => setMode('discard')}
              className="rounded border px-2 py-1"
            >
              Descartar
            </button>
          </>
        )}
      </div>
      {mode === 'duplicate' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (original) moderate.mutate({ status: 'duplicate', duplicateOf: original });
          }}
          className="space-y-1"
        >
          <label htmlFor={originalId} className="block font-medium">
            Original
          </label>
          <select
            id={originalId}
            value={original}
            onChange={(event) => setOriginal(event.target.value)}
            className="w-full rounded border px-2 py-1"
          >
            <option value="">Elige el requisito original</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {detailSummary(candidate)}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!original}
              className="rounded bg-blue-700 px-2 py-1 text-white disabled:opacity-50"
            >
              Confirmar duplicado
            </button>
            <button
              type="button"
              onClick={() => setMode(null)}
              className="rounded border px-2 py-1"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {mode === 'discard' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim())
              moderate.mutate({ status: 'discarded', discardReason: reason.trim() });
          }}
          className="space-y-1"
        >
          <label htmlFor={reasonId} className="block font-medium">
            Motivo del descarte
          </label>
          <textarea
            id={reasonId}
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded border px-2 py-1"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!reason.trim()}
              className="rounded bg-red-700 px-2 py-1 text-white disabled:opacity-50"
            >
              Confirmar descarte
            </button>
            <button
              type="button"
              onClick={() => setMode(null)}
              className="rounded border px-2 py-1"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      <FormError>{error}</FormError>
    </div>
  );
}
