import type { ActivityProposal, ActivityType, ProposalAcceptInput } from '@reqcanvas/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { diagramKeys } from '../diagrams/api';
import { TYPE_LABEL } from '../diagrams/labels';
import { useCanWrite } from '../realtime/connection';
import type { RealtimeSocket } from '../realtime/socket';
import { detectionApi, detectionKeys } from './api';
import { CONFIDENCE } from './labels';
import { useDetection } from './useDetection';

const TYPES = Object.keys(TYPE_LABEL) as ActivityType[];

/** Las que acepta «Aceptar todas las de confianza alta» (la API aplica la misma regla). */
export const acceptableInBulk = (proposal: ActivityProposal) =>
  proposal.confidenceLevel === 'high' &&
  !proposal.flags.includes('possible_duplicate') &&
  (proposal.type !== 'action' || proposal.label.trim() !== '');

function useReview(versionId: string) {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: detectionKeys.proposals(versionId) });
    void client.invalidateQueries({ queryKey: detectionKeys.job(versionId) });
    void client.invalidateQueries({ queryKey: diagramKeys.version(versionId) });
  };
  return {
    accept: useMutation({
      mutationFn: ({ id, input }: { id: string; input: ProposalAcceptInput }) =>
        detectionApi.accept(id, input),
      onSuccess: refresh,
    }),
    discard: useMutation({
      mutationFn: (proposalId: string) => detectionApi.discard(proposalId),
      onSuccess: refresh,
    }),
    acceptHigh: useMutation({
      mutationFn: () => detectionApi.acceptHigh(versionId),
      onSuccess: refresh,
    }),
  };
}

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : 'No se pudo guardar. Vuelve a intentarlo.';

function ProposalItem({
  proposal,
  review,
  disabled,
}: {
  proposal: ActivityProposal;
  review: ReturnType<typeof useReview>;
  disabled: boolean;
}) {
  const [label, setLabel] = useState(proposal.label);
  const [type, setType] = useState<ActivityType>(proposal.type);
  const [error, setError] = useState('');
  const confidence = CONFIDENCE[proposal.confidenceLevel];
  const needsName = type === 'action' && label.trim() === '';
  const name = proposal.label || 'Sin nombre';

  const accept = () => {
    setError('');
    const input: ProposalAcceptInput = {};
    if (label.trim() !== proposal.label) input.label = label.trim();
    if (type !== proposal.type) input.type = type;
    review.accept.mutate({ id: proposal.id, input }, { onError: (err) => setError(message(err)) });
  };
  const discard = () => {
    setError('');
    review.discard.mutate(proposal.id, { onError: (err) => setError(message(err)) });
  };

  return (
    <li aria-label={`Propuesta ${name}`} className="space-y-2 rounded border p-2">
      <p className="text-sm">
        <span aria-hidden="true" style={{ color: confidence.color }}>
          {confidence.icon}
        </span>{' '}
        {confidence.label}
      </p>
      {proposal.flags.includes('possible_duplicate') && (
        <p className="text-sm text-amber-800">
          Posible duplicado de una actividad existente: no se acepta en bloque.
        </p>
      )}
      <label className="block text-sm">
        Nombre
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={120}
          className="mt-1 w-full rounded border px-2 py-1"
        />
      </label>
      <label className="block text-sm">
        Tipo
        <select
          value={type}
          onChange={(event) => setType(event.target.value as ActivityType)}
          className="mt-1 w-full rounded border px-2 py-1"
        >
          {TYPES.map((option) => (
            <option key={option} value={option}>
              {TYPE_LABEL[option]}
            </option>
          ))}
        </select>
      </label>
      {needsName && <p className="text-sm text-gray-600">Escribe el nombre para aceptarla.</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={accept}
          disabled={disabled || needsName}
          className="rounded border px-2 py-1 disabled:opacity-50"
        >
          Aceptar
        </button>
        <button
          type="button"
          onClick={discard}
          disabled={disabled}
          className="rounded border px-2 py-1 disabled:opacity-50"
        >
          Descartar
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * Revisión de las propuestas (US2, FR-005 y FR-006): aceptar, corregir y aceptar, o descartar
 * cada una, y aceptar en bloque las de confianza alta. Aceptada, es una actividad normal: su
 * zona se ajusta con el editor de la 003.
 */
export function ProposalReviewPanel({
  versionId,
  socket,
}: {
  versionId: string;
  socket: RealtimeSocket | null;
}) {
  const { proposals } = useDetection(versionId, socket);
  const review = useReview(versionId);
  const canWrite = useCanWrite();
  const [bulkError, setBulkError] = useState('');
  const pending = proposals?.activities ?? [];
  if (pending.length === 0) return null;
  const bulk = pending.filter(acceptableInBulk).length;
  const busy = review.accept.isPending || review.discard.isPending || review.acceptHigh.isPending;

  return (
    <section aria-label="Propuestas pendientes" className="space-y-2">
      <h2 className="font-semibold">Propuestas pendientes ({pending.length})</h2>
      <button
        type="button"
        onClick={() =>
          review.acceptHigh.mutate(undefined, { onError: (err) => setBulkError(message(err)) })
        }
        disabled={bulk === 0 || busy || !canWrite}
        className="rounded border px-3 py-1 disabled:opacity-50"
      >
        Aceptar todas las de confianza alta ({bulk})
      </button>
      {bulkError && (
        <p role="alert" className="text-sm text-red-700">
          {bulkError}
        </p>
      )}
      <ul className="space-y-2">
        {pending.map((proposal) => (
          <ProposalItem
            key={proposal.id}
            proposal={proposal}
            review={review}
            disabled={busy || !canWrite}
          />
        ))}
      </ul>
    </section>
  );
}
