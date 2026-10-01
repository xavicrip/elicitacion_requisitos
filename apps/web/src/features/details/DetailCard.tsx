import type { Detail, Facets } from '@reqcanvas/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useId, useState } from 'react';
import { FormError } from '../../components/form';
import { ApiError } from '../../lib/api-client';
import { detailKeys, detailsApi } from './api';
import { DetailForm } from './DetailForm';
import { DETAIL_STATUS_LABEL, DETAIL_TYPE_LABEL, PRIORITY_LABEL } from './labels';

// `diff` solo se descarga al abrir el historial.
const HistoryDrawer = lazy(() => import('./HistoryDrawer'));

const dateFormat = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});

/**
 * Un detalle de requisito: escenario Dado/Cuando/Entonces, metadatos y acciones según sus
 * permisos. El texto es texto plano: React lo escapa, nunca se interpreta (constitución V).
 */
export function DetailCard({
  detail,
  projectId,
  facets,
}: {
  detail: Detail;
  projectId: string;
  facets?: Facets;
}) {
  const queryClient = useQueryClient();
  const confirmId = useId();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');

  const remove = useMutation({
    mutationFn: () => detailsApi.remove(detail.id),
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: detailKeys.all });
    },
    onError: (err) => {
      setConfirming(false);
      setError(err instanceof ApiError ? err.message : 'No se pudo eliminar el requisito.');
    },
  });

  if (editing) {
    return (
      <article className="rounded border p-3">
        <DetailForm
          projectId={projectId}
          diagramId={detail.diagramId}
          activityKey={detail.activityKey}
          facets={facets}
          detail={detail}
          onDone={() => setEditing(false)}
        />
      </article>
    );
  }

  return (
    <article className="space-y-2 rounded border p-3 text-sm">
      <dl className="space-y-1">
        <div>
          <dt className="inline font-semibold">Dado </dt>
          <dd className="inline">{detail.given}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Cuando </dt>
          <dd className="inline">{detail.when}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Entonces </dt>
          <dd className="inline">{detail.then}</dd>
        </div>
      </dl>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-gray-600">
        <span>{DETAIL_TYPE_LABEL[detail.type]}</span>
        {detail.priority && <span>{PRIORITY_LABEL[detail.priority]}</span>}
        {detail.status !== 'pending' && <span>{DETAIL_STATUS_LABEL[detail.status]}</span>}
        {detail.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
      </p>
      <p className="text-gray-600">
        {detail.author.name}
        {detail.authorRole && ` · ${detail.authorRole}`} ·{' '}
        <time dateTime={detail.createdAt}>{dateFormat.format(new Date(detail.createdAt))}</time> ·{' '}
        {detail.voteCount} voto(s)
      </p>
      <div className="flex flex-wrap gap-2">
        {detail.permissions.canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border px-2 py-1"
          >
            Editar
          </button>
        )}
        {detail.permissions.canDelete && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded border border-red-700 px-2 py-1 text-red-700"
          >
            Eliminar
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowHistory(true)}
          className="rounded border px-2 py-1"
        >
          Historial
        </button>
      </div>
      <FormError>{error}</FormError>
      {confirming && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={confirmId}
          className="space-y-2 rounded border border-red-300 bg-red-50 p-3"
        >
          <p id={confirmId}>
            ¿Eliminar este requisito? También se borrarán sus {detail.voteCount} voto(s) y{' '}
            {detail.commentCount} comentario(s).
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border px-3 py-1"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="rounded bg-red-700 px-3 py-1 text-white disabled:opacity-50"
            >
              Eliminar requisito
            </button>
          </div>
        </div>
      )}
      {showHistory && (
        <Suspense fallback={null}>
          <HistoryDrawer detailId={detail.id} onClose={() => setShowHistory(false)} />
        </Suspense>
      )}
    </article>
  );
}
