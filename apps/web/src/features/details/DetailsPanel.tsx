import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { SidePanelContext } from '../diagrams/workspace/WorkspacePage';
import { detailKeys, detailsApi, type DetailsQuery } from './api';
import { DetailCard } from './DetailCard';
import { DetailForm } from './DetailForm';
import type { HeatmapScale } from './overlays/Heatmap';
import { DetailFilters } from './DetailFilters';
import { HeatmapLegend } from './overlays/HeatmapLegend';

/**
 * Panel lateral de requisitos de la actividad seleccionada (FR-001): sus detalles, ordenados
 * por votos y fecha, y el formulario de alta si el proyecto está abierto.
 */
export function DetailsPanel({
  activityKey,
  project,
  diagramId,
  version,
  heatmap,
}: SidePanelContext & {
  activityKey: string | null;
  /** Capa del mapa de calor (FR-011): se activa desde el panel, que muestra su leyenda. */
  heatmap?: { on: boolean; toggle: () => void; legend?: HeatmapScale['legend'] };
}) {
  const activity = version.activities.find((candidate) => candidate.key === activityKey);
  const [query, setQuery] = useState<DetailsQuery>({ sort: 'votes' });
  const details = useQuery({
    queryKey: detailKeys.list(diagramId, activityKey ?? '', query),
    queryFn: () => detailsApi.list(diagramId, activityKey!, query),
    enabled: Boolean(activity),
  });
  // También alimentan el filtro por etiqueta.
  const facets = useQuery({
    queryKey: detailKeys.facets(project.id),
    queryFn: () => detailsApi.facets(project.id),
    enabled: Boolean(activity),
    staleTime: 60_000,
  });

  return (
    <aside aria-label="Requisitos" className="space-y-3">
      {heatmap && (
        <div className="space-y-2 border-b pb-2">
          <button
            type="button"
            aria-pressed={heatmap.on}
            onClick={heatmap.toggle}
            className="rounded border px-3 py-1 text-sm aria-pressed:bg-orange-100"
          >
            Mapa de calor
          </button>
          {heatmap.on && heatmap.legend && <HeatmapLegend legend={heatmap.legend} />}
        </div>
      )}
      {!activity ? (
        <p className="text-sm text-gray-600">
          Selecciona una actividad del diagrama para ver y registrar sus requisitos.
        </p>
      ) : (
        <>
          <h2 className="font-semibold">Requisitos de «{activity.label}»</h2>
          <DetailFilters query={query} onChange={setQuery} tags={facets.data?.tags ?? []} />
          {details.isLoading && <p className="text-sm">Cargando…</p>}
          {details.data?.length === 0 && (
            <p className="text-sm text-gray-600">Esta actividad aún no tiene requisitos.</p>
          )}
          <div className="space-y-2">
            {details.data?.map((detail) => (
              <DetailCard
                key={detail.id}
                detail={detail}
                projectId={project.id}
                facets={facets.data}
                projectOpen={project.status === 'open'}
                siblings={details.data}
              />
            ))}
          </div>
          {version.status !== 'published' ? (
            <p className="text-sm text-gray-600">
              Los requisitos se registran sobre la versión publicada del diagrama.
            </p>
          ) : project.status === 'open' ? (
            <DetailForm
              key={activity.key}
              projectId={project.id}
              diagramId={diagramId}
              activityKey={activity.key}
              facets={facets.data}
            />
          ) : (
            <p className="text-sm text-gray-600">
              El proyecto está cerrado o en borrador: no admite requisitos nuevos.
            </p>
          )}
        </>
      )}
    </aside>
  );
}
