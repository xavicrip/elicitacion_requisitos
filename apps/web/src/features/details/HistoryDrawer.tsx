import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { FormError } from '../../components/form';
import { detailKeys, detailsApi } from './api';

const dateFormat = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const CHANGE_LABEL = { edit: 'Edición', status: 'Moderación', reassign: 'Reasignación' };

/** Versiones anteriores de un requisito: quién y cuándo lo cambió (FR-006, research R3). */
export default function HistoryDrawer({
  detailId,
  onClose,
}: {
  detailId: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const history = useQuery({
    queryKey: detailKeys.history(detailId),
    queryFn: () => detailsApi.history(detailId),
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-20 flex justify-end bg-black/40"
    >
      <div className="h-full w-full max-w-md space-y-4 overflow-auto bg-white p-6 text-sm">
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">
            Historial del requisito
          </h2>
          <button type="button" onClick={onClose} className="rounded border px-3 py-1">
            Cerrar
          </button>
        </div>
        {history.isLoading && <p>Cargando…</p>}
        {history.isError && <FormError>No se pudo cargar el historial.</FormError>}
        {history.data?.length === 0 && <p>Este requisito no se ha modificado.</p>}
        <ol className="space-y-3">
          {history.data?.map((entry) => {
            const snapshot = entry.snapshot as { given?: string; when?: string; then?: string };
            return (
              <li key={`${entry.rev}-${entry.editedAt}`} className="space-y-1 border-l-2 pl-3">
                <p className="text-gray-600">
                  {CHANGE_LABEL[entry.change]} de {entry.editedBy.name} ·{' '}
                  <time dateTime={entry.editedAt}>
                    {dateFormat.format(new Date(entry.editedAt))}
                  </time>
                </p>
                <p className="text-xs text-gray-600">Versión anterior al cambio:</p>
                <p>
                  <strong>Dado</strong> {snapshot.given}
                </p>
                <p>
                  <strong>Cuando</strong> {snapshot.when}
                </p>
                <p>
                  <strong>Entonces</strong> {snapshot.then}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
