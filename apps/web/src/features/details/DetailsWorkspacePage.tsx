import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '../diagrams/workspace/store';
import { WorkspacePage } from '../diagrams/workspace/WorkspacePage';
import { useFlags } from '../../lib/flags';
import { detailKeys, detailsApi } from './api';
import { DetailsPanel } from './DetailsPanel';
import { coverageHotspots, heatmapScale } from './overlays/Heatmap';

/**
 * Espacio de trabajo de la 003 con los requisitos de la 004 (plan, ajuste 8): panel lateral de
 * detalles, indicadores de cobertura en las zonas (contador, «sin detalles», mapa de calor y
 * notas) y, para el Administrador, el cambio entre el borrador y la versión publicada. Sin el
 * flag `details`, es el espacio de trabajo de la 003 tal cual.
 */
export function DetailsWorkspacePage() {
  const { flags, isLoading } = useFlags();
  const [preferPublished, setPreferPublished] = useState(false);
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const versionId = useWorkspaceStore((state) => state.versionId);
  const heatmap = useWorkspaceStore((state) => Boolean(state.overlays.heatmap));
  const setOverlay = useWorkspaceStore((state) => state.setOverlay);

  const coverage = useQuery({
    queryKey: detailKeys.coverage(versionId),
    queryFn: () => detailsApi.coverage(versionId),
    enabled: Boolean(flags.details && versionId),
  });
  const hotspots = useMemo(
    () =>
      coverageHotspots(coverage.data, {
        heatmap,
        openNotes,
        toggleNotes: (key) =>
          setOpenNotes((current) => {
            const next = new Set(current);
            if (!next.delete(key)) next.add(key);
            return next;
          }),
      }),
    [coverage.data, heatmap, openNotes],
  );
  const legend = useMemo(
    () => heatmapScale((coverage.data ?? []).map((entry) => entry.total)).legend,
    [coverage.data],
  );

  if (isLoading) return null;
  if (!flags.details) return <WorkspacePage />;
  return (
    <WorkspacePage
      preferPublished={preferPublished}
      onPreferPublishedChange={setPreferPublished}
      {...hotspots}
      sidePanel={(activityKey, context) => (
        <DetailsPanel
          activityKey={activityKey}
          {...context}
          heatmap={{
            on: heatmap,
            toggle: () => setOverlay('heatmap', !heatmap),
            legend: coverage.data ? legend : undefined,
          }}
        />
      )}
    />
  );
}
