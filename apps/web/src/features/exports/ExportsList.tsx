import type { Export } from '@reqcanvas/shared';
import { useQuery } from '@tanstack/react-query';
import { FormError } from '../../components/form';
import { exportKeys, exportsApi } from './api';

const dateTime = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });
const number = new Intl.NumberFormat('es');

export const FORMAT_LABEL: Record<Export['format'], string> = {
  csv: 'CSV',
  xlsx: 'Excel',
  gherkin: 'Gherkin',
  pdf: 'Reporte PDF',
};

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${number.format(Math.round(bytes / 1024))} KB`;
  return `${number.format(Math.round((bytes / 1024 / 1024) * 10) / 10)} MB`;
}

function stateOf(exported: Export): string {
  if (exported.status === 'failed') return 'Fallida';
  if (exported.status !== 'done') return 'En preparación';
  if (exported.mode === 'sync') return 'Descargada al momento';
  return exported.expired ? 'Caducada' : 'Lista';
}

/** Historial de exportaciones del proyecto, con la descarga de las que siguen disponibles. */
export function ExportsList({
  projectId,
  onDownload,
}: {
  projectId: string;
  onDownload: (exported: Export) => void;
}) {
  const list = useQuery({
    queryKey: exportKeys.list(projectId),
    queryFn: () => exportsApi.list(projectId),
  });
  if (list.isLoading) return <p>Cargando el historial…</p>;
  if (list.error) return <FormError>No se pudo cargar el historial.</FormError>;
  if (!list.data?.length) return <p className="text-sm">Aún no hay exportaciones.</p>;
  return (
    <ul aria-label="Historial de exportaciones" className="divide-y text-sm">
      {list.data.map((exported) => (
        <li key={exported.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <span className="font-medium">{FORMAT_LABEL[exported.format]}</span>
          <span>{dateTime.format(new Date(exported.createdAt))}</span>
          <span>{number.format(exported.detailCount)} requisitos</span>
          {exported.bytes !== null && <span>{size(exported.bytes)}</span>}
          <span>{stateOf(exported)}</span>
          {exported.error && <span>{exported.error.message}</span>}
          {exported.mode === 'async' && exported.status === 'done' && !exported.expired && (
            <button type="button" onClick={() => onDownload(exported)} className="underline">
              Descargar
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
