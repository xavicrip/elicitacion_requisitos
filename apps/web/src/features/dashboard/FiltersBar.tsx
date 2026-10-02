import type { DashboardFilters, DetailStatus, DetailType } from '@reqcanvas/shared';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { DETAIL_STATUS_LABEL, DETAIL_TYPE_LABEL } from '../details/labels';
import { diagramKeys, diagramsApi } from '../diagrams/api';

const TYPES = Object.keys(DETAIL_TYPE_LABEL) as DetailType[];
/** Los duplicados nunca se cuentan aparte: su original ya los representa. */
const STATUSES: DetailStatus[] = ['pending', 'validated', 'discarded'];

/**
 * Filtros del dashboard (FR-003), en una fila sobre los gráficos: diagrama, tipo, fechas y
 * estados. Cada cambio recalcula todos los indicadores.
 */
export function FiltersBar({
  projectId,
  filters,
  onChange,
}: {
  projectId: string;
  filters: DashboardFilters;
  onChange: (filters: DashboardFilters) => void;
}) {
  const ids = { diagram: useId(), type: useId(), from: useId(), to: useId() };
  const diagrams = useQuery({
    queryKey: diagramKeys.list(projectId),
    queryFn: () => diagramsApi.list(projectId),
  });
  const published = diagrams.data?.filter((diagram) => diagram.publishedVersionId) ?? [];
  const toggleStatus = (status: DetailStatus, checked: boolean) => {
    const statuses = checked
      ? [...filters.statuses, status]
      : filters.statuses.filter((item) => item !== status);
    // Al menos un estado: sin ninguno no habría nada que mostrar.
    if (statuses.length > 0) onChange({ ...filters, statuses });
  };

  return (
    <form
      aria-label="Filtros"
      onSubmit={(event) => event.preventDefault()}
      className="flex flex-wrap items-end gap-3 rounded border p-3"
    >
      <div className="space-y-1">
        <label htmlFor={ids.diagram} className="block text-sm">
          Diagrama
        </label>
        <select
          id={ids.diagram}
          value={filters.diagramIds?.[0] ?? ''}
          onChange={(event) =>
            onChange({ ...filters, diagramIds: event.target.value ? [event.target.value] : null })
          }
          className="rounded border px-2 py-1"
        >
          <option value="">Todos</option>
          {published.map((diagram) => (
            <option key={diagram.id} value={diagram.id}>
              {diagram.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={ids.type} className="block text-sm">
          Tipo
        </label>
        <select
          id={ids.type}
          value={filters.types?.[0] ?? ''}
          onChange={(event) =>
            onChange({
              ...filters,
              types: event.target.value ? [event.target.value as DetailType] : null,
            })
          }
          className="rounded border px-2 py-1"
        >
          <option value="">Todos</option>
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {DETAIL_TYPE_LABEL[type]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={ids.from} className="block text-sm">
          Desde
        </label>
        <input
          id={ids.from}
          type="date"
          value={filters.from ?? ''}
          max={filters.to ?? undefined}
          onChange={(event) => onChange({ ...filters, from: event.target.value || null })}
          className="rounded border px-2 py-1"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={ids.to} className="block text-sm">
          Hasta
        </label>
        <input
          id={ids.to}
          type="date"
          value={filters.to ?? ''}
          min={filters.from ?? undefined}
          onChange={(event) => onChange({ ...filters, to: event.target.value || null })}
          className="rounded border px-2 py-1"
        />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm">Estado</legend>
        <div className="flex gap-3">
          {STATUSES.map((status) => (
            <label key={status} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={filters.statuses.includes(status)}
                onChange={(event) => toggleStatus(status, event.target.checked)}
              />
              {DETAIL_STATUS_LABEL[status]}
            </label>
          ))}
        </div>
      </fieldset>
    </form>
  );
}
