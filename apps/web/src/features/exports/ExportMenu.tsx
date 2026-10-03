import type { DashboardFilters, ExportFormat, ExportOptions } from '@reqcanvas/shared';
import { useId, useState } from 'react';
import { FormError } from '../../components/form';
import { ExportsList } from './ExportsList';
import type { ExportInput } from './api';
import { useExport } from './useExport';

const BUTTON = 'rounded border px-3 py-1 text-sm disabled:opacity-50';

/**
 * Exportación del levantamiento (feature 008): los requisitos con los filtros activos del
 * dashboard. Las exportaciones grandes se preparan en segundo plano y se avisa al terminar.
 */
export function ExportMenu({
  projectId,
  filters,
}: {
  projectId: string;
  filters: DashboardFilters;
}) {
  const ids = { delimiter: useId(), pending: useId(), history: useId() };
  const [delimiter, setDelimiter] = useState<ExportOptions['delimiter']>('comma');
  const [history, setHistory] = useState(false);
  const [includePending, setIncludePending] = useState(false);
  const [format, setFormat] = useState<ExportFormat | null>(null);
  const exporting = useExport(projectId);
  const request = (input: ExportInput) => {
    setFormat(input.format);
    exporting.request(input);
  };

  return (
    <section aria-label="Exportar" className="space-y-3 rounded border p-3">
      <h2 className="text-lg font-semibold">Exportar</h2>
      <p className="text-sm text-gray-600">
        Se exportan los requisitos que cumplen los filtros de arriba. Gherkin lleva solo los
        validados, con un archivo <code>.feature</code> por actividad.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={exporting.busy}
          onClick={() => request({ format: 'xlsx', filters })}
          className={BUTTON}
        >
          Exportar a Excel
        </button>
        <button
          type="button"
          disabled={exporting.busy}
          onClick={() => request({ format: 'csv', filters, options: { delimiter } })}
          className={BUTTON}
        >
          Exportar a CSV
        </button>
        <span className="flex items-center gap-2 text-sm">
          <label htmlFor={ids.delimiter}>Separador del CSV</label>
          <select
            id={ids.delimiter}
            value={delimiter}
            onChange={(event) => setDelimiter(event.target.value as ExportOptions['delimiter'])}
            className="rounded border px-2 py-1"
          >
            <option value="comma">Coma</option>
            <option value="semicolon">Punto y coma</option>
          </select>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={exporting.busy}
          onClick={() => request({ format: 'gherkin', filters, options: { includePending } })}
          className={BUTTON}
        >
          Exportar a Gherkin
        </button>
        <span className="flex items-center gap-2 text-sm">
          <input
            id={ids.pending}
            type="checkbox"
            checked={includePending}
            onChange={(event) => setIncludePending(event.target.checked)}
          />
          <label htmlFor={ids.pending}>Incluir pendientes</label>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={exporting.busy}
          onClick={() => request({ format: 'pdf', filters })}
          className={BUTTON}
        >
          Generar reporte PDF
        </button>
        <span className="text-sm text-gray-600">
          Con los diagramas, los indicadores, los hallazgos del último análisis y el listado de
          requisitos. Se prepara en segundo plano.
        </span>
      </div>

      {exporting.preparing && (
        <p role="status" className="text-sm">
          {format === 'pdf' ? 'Generando el reporte PDF…' : 'Preparando la exportación…'}
        </p>
      )}
      {exporting.ready && (
        <p role="status" className="flex flex-wrap items-center gap-3 text-sm">
          Tu exportación está lista.
          <button
            type="button"
            onClick={() => exporting.download(exporting.ready!)}
            className="underline"
          >
            Descargar
          </button>
        </p>
      )}
      {exporting.empty && (
        <p role="status" className="text-sm">
          {format === 'gherkin'
            ? 'No hay requisitos validados con estos filtros: el ZIP solo lleva un LEEME.txt. Marca «Incluir pendientes» para exportar también los pendientes.'
            : 'No hay requisitos con estos filtros: el archivo solo lleva los encabezados.'}
        </p>
      )}
      <FormError>{exporting.error || exporting.failed?.error?.message || ''}</FormError>

      <button
        type="button"
        aria-expanded={history}
        aria-controls={ids.history}
        onClick={() => setHistory((open) => !open)}
        className="text-sm underline"
      >
        Historial de exportaciones
      </button>
      {history && (
        <div id={ids.history}>
          <ExportsList projectId={projectId} onDownload={exporting.download} />
        </div>
      )}
    </section>
  );
}
