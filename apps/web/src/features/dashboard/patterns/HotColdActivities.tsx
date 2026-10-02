import type { AnalysisResults } from '@reqcanvas/shared';
import type { Lookup } from '../text/lookup';

type Heat = NonNullable<AnalysisResults['hotcold']>;

function Group({
  title,
  icon,
  empty,
  items,
  lookup,
}: {
  title: string;
  icon: string;
  empty: string;
  items: Heat;
  lookup: Lookup;
}) {
  return (
    <section aria-label={title} className="space-y-1 rounded border p-3">
      <h3 className="font-semibold">
        <span aria-hidden="true">{icon} </span>
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-gray-600">{empty}</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {items.map((item) => (
            <li key={item.activityKey}>
              <span className="font-medium">{lookup.activityLabel(item.activityKey)}</span>:{' '}
              {item.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Actividades críticas (US4-3): las calientes concentran volumen, votos o desacuerdo; las frías
 * tienen poca o ninguna cobertura. Cada una con su motivo, en texto e icono, no solo en color.
 */
export function HotColdActivities({ heat, lookup }: { heat: Heat; lookup: Lookup }) {
  const hot = heat.filter((item) => item.class === 'hot').sort((a, b) => b.score - a.score);
  const cold = heat.filter((item) => item.class === 'cold').sort((a, b) => a.score - b.score);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Group
        title="Actividades calientes"
        icon="▲"
        empty="Ninguna actividad destaca sobre las demás."
        items={hot}
        lookup={lookup}
      />
      <Group
        title="Actividades frías"
        icon="▽"
        empty="Todas las actividades tienen aportes."
        items={cold}
        lookup={lookup}
      />
    </div>
  );
}
