import type { DetailStatus, DetailType, Facet, Priority } from '@reqcanvas/shared';
import { useId } from 'react';
import type { DetailsQuery } from './api';
import { DETAIL_STATUS_LABEL, DETAIL_TYPE_LABEL, PRIORITY_LABEL } from './labels';

function Filter({
  label,
  value,
  options,
  onChange,
  all = 'Todos',
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  all?: string | null;
}) {
  const id = useId();
  return (
    <div className="space-y-0.5">
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded border px-1 py-0.5 text-xs"
      >
        {all !== null && <option value="">{all}</option>}
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Filtros por estado, tipo, prioridad y etiqueta, y orden por votos o fecha (FR-012). */
export function DetailFilters({
  query,
  onChange,
  tags,
}: {
  query: DetailsQuery;
  onChange: (query: DetailsQuery) => void;
  tags: Facet[];
}) {
  const set = (field: keyof DetailsQuery) => (value: string) =>
    onChange({ ...query, [field]: value || undefined });
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Filter
        label="Orden"
        value={query.sort}
        all={null}
        options={[
          ['votes', 'Más votados'],
          ['recent', 'Más recientes'],
        ]}
        onChange={(value) => onChange({ ...query, sort: value as DetailsQuery['sort'] })}
      />
      <Filter
        label="Estado"
        value={query.status ?? ''}
        options={Object.entries(DETAIL_STATUS_LABEL) as Array<[DetailStatus, string]>}
        onChange={set('status')}
      />
      <Filter
        label="Tipo de requisito"
        value={query.type ?? ''}
        options={Object.entries(DETAIL_TYPE_LABEL) as Array<[DetailType, string]>}
        onChange={set('type')}
      />
      <Filter
        label="Prioridad del requisito"
        value={query.priority ?? ''}
        all="Todas"
        options={Object.entries(PRIORITY_LABEL) as Array<[Priority, string]>}
        onChange={set('priority')}
      />
      <Filter
        label="Etiqueta"
        value={query.tag ?? ''}
        all="Todas"
        options={tags.map((tag) => [tag.value, tag.value])}
        onChange={set('tag')}
      />
    </div>
  );
}
