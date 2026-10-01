import type { Detail } from '@reqcanvas/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { detailKeys, detailsApi } from './api';

/**
 * Voto (+1) con actualización optimista (FR-008): el contador cambia al pulsar y vuelve atrás si
 * la API lo rechaza. Los detalles propios no se votan; un voto ya dado se puede retirar mientras
 * el proyecto esté abierto (FR-013).
 */
export function VoteButton({ detail, projectOpen }: { detail: Detail; projectOpen: boolean }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ voteCount: detail.voteCount, votedByMe: detail.votedByMe });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setState({ voteCount: detail.voteCount, votedByMe: detail.votedByMe });
  }, [detail.voteCount, detail.votedByMe]);

  const canToggle = detail.permissions.canVote || (projectOpen && state.votedByMe);

  const toggle = async () => {
    const before = state;
    const voted = !state.votedByMe;
    setError('');
    setPending(true);
    setState({ voteCount: state.voteCount + (voted ? 1 : -1), votedByMe: voted });
    try {
      setState(await detailsApi.vote(detail.id, voted));
      // El orden por votos y los votos efectivos de la cobertura cambian.
      await queryClient.invalidateQueries({ queryKey: detailKeys.all });
    } catch (err) {
      setState(before);
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar el voto.');
    } finally {
      setPending(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={state.votedByMe}
        disabled={pending || !canToggle}
        title={canToggle ? undefined : 'No puedes votar este requisito'}
        onClick={() => void toggle()}
        className="rounded border px-2 py-1 aria-pressed:bg-blue-100 disabled:opacity-50"
      >
        Votar
      </button>
      <span>{state.voteCount} voto(s)</span>
      {error && (
        <span role="alert" className="text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}
