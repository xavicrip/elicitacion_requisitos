import type { AnalysisResults } from '@reqcanvas/shared';
import { useId, useState } from 'react';
import type { Lookup } from './lookup';

type ByActivity = NonNullable<NonNullable<AnalysisResults['keywords']>['byActivity']>;

/**
 * Palabras y frases clave de una actividad (US2-2): los términos que más la distinguen de las
 * demás, de mayor a menor, con una barra proporcional a su peso.
 */
export function Keywords({ byActivity, lookup }: { byActivity: ByActivity; lookup: Lookup }) {
  const selectId = useId();
  const [key, setKey] = useState(byActivity[0]?.activityKey ?? '');
  const current = byActivity.find((entry) => entry.activityKey === key) ?? byActivity[0];
  if (!current) return <p>No hay palabras clave: aún no hay detalles.</p>;
  const max = current.terms[0]?.weight || 1;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={selectId} className="block text-sm">
          Actividad
        </label>
        <select
          id={selectId}
          value={current.activityKey}
          onChange={(event) => setKey(event.target.value)}
          className="rounded border px-2 py-1"
        >
          {byActivity.map((entry) => (
            <option key={entry.activityKey} value={entry.activityKey}>
              {lookup.activityLabel(entry.activityKey)}
            </option>
          ))}
        </select>
      </div>
      <ol
        aria-label={`Términos distintivos de ${lookup.activityLabel(current.activityKey)}`}
        className="space-y-1"
      >
        {current.terms.map((term) => (
          <li key={term.term} className="grid grid-cols-[12rem_1fr] items-center gap-2 text-sm">
            <span>{term.term}</span>
            <span aria-hidden="true" className="h-2 rounded-r bg-gray-100">
              <span
                className="block h-2 rounded-r"
                style={{ width: `${(term.weight / max) * 100}%`, backgroundColor: '#2a78d6' }}
              />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
