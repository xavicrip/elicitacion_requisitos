import type { DescriptiveDashboard } from '@reqcanvas/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { heatmapScale } from '../../details/overlays/Heatmap';
import { diagramKeys, diagramsApi, useImageUrl } from '../../diagrams/api';

/**
 * Mapa de cobertura sobre el diagrama (US1): cada actividad publicada es una zona coloreada
 * por su número de detalles (la escala de la 004); al pulsarla se ven sus indicadores y el
 * acceso a sus requisitos. El número va también en texto: el color no es la única señal.
 */
export function CoverageMap({
  projectId,
  byActivity,
}: {
  projectId: string;
  byActivity: DescriptiveDashboard['byActivity'];
}) {
  const selectId = useId();
  const diagrams = useQuery({
    queryKey: diagramKeys.list(projectId),
    queryFn: () => diagramsApi.list(projectId),
  });
  const published = diagrams.data?.filter((diagram) => diagram.publishedVersionId) ?? [];
  const [chosen, setChosen] = useState('');
  const diagram = published.find((item) => item.id === chosen) ?? published[0];
  const versionId = diagram?.publishedVersionId ?? '';
  const version = useQuery({
    queryKey: diagramKeys.version(versionId),
    queryFn: () => diagramsApi.version(versionId),
    enabled: Boolean(versionId),
  });
  const imageUrl = useImageUrl(version.data?.image.displayUrl);
  const [selected, setSelected] = useState<string | null>(null);

  if (!diagram) return <p className="text-sm text-gray-600">Aún no hay diagramas publicados.</p>;

  const counts = new Map(byActivity.map((entry) => [entry.key, entry.count]));
  const activities = version.data?.activities ?? [];
  const scale = heatmapScale(activities.map((activity) => counts.get(activity.key) ?? 0));
  const total = byActivity.reduce((sum, entry) => sum + entry.count, 0);
  const current = activities.find((activity) => activity.key === selected);
  const currentCount = current ? (counts.get(current.key) ?? 0) : 0;

  return (
    <section aria-label="Mapa de cobertura" className="space-y-2 rounded border p-3">
      <h2 className="font-semibold">Mapa de cobertura</h2>
      {published.length > 1 && (
        <div className="space-y-1">
          <label htmlFor={selectId} className="block text-sm">
            Diagrama
          </label>
          <select
            id={selectId}
            value={diagram.id}
            onChange={(event) => {
              setChosen(event.target.value);
              setSelected(null);
            }}
            className="rounded border px-2 py-1"
          >
            {published.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="relative w-full overflow-hidden rounded border">
        {imageUrl && (
          <img src={imageUrl} alt={`Diagrama ${diagram.name}`} className="block w-full" />
        )}
        {activities.map((activity) => {
          const count = counts.get(activity.key) ?? 0;
          return (
            <button
              key={activity.key}
              type="button"
              aria-pressed={selected === activity.key}
              aria-label={`${activity.label}: ${count} ${count === 1 ? 'detalle' : 'detalles'}`}
              onClick={() => setSelected(activity.key)}
              className="absolute flex items-center justify-center rounded border-2 border-gray-900/60 text-xs font-semibold text-gray-900"
              style={{
                left: `${activity.bbox.x * 100}%`,
                top: `${activity.bbox.y * 100}%`,
                width: `${activity.bbox.w * 100}%`,
                height: `${activity.bbox.h * 100}%`,
                backgroundColor: count === 0 ? 'rgb(255 255 255 / 0.6)' : scale.colorOf(count),
                opacity: 0.85,
              }}
            >
              <span className="rounded bg-white/90 px-1">{count}</span>
            </button>
          );
        })}
      </div>
      <ul aria-label="Escala de color" className="flex flex-wrap gap-3 text-sm">
        {scale.legend.map((step) => (
          <li key={step.label} className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-sm border"
              style={{ backgroundColor: step.color }}
            />
            {step.label}
          </li>
        ))}
      </ul>
      {current && (
        <div role="status" className="rounded bg-gray-50 p-3 text-sm">
          <p className="font-semibold">{current.label}</p>
          <p>
            {currentCount} {currentCount === 1 ? 'detalle' : 'detalles'}
            {total > 0 && ` · ${Math.round((currentCount / total) * 100)} % del total`}
          </p>
          <Link
            to={`/proyectos/${projectId}/diagramas/${diagram.id}`}
            className="text-blue-700 underline"
          >
            Ver sus requisitos en el diagrama
          </Link>
        </div>
      )}
    </section>
  );
}
