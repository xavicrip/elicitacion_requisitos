import type { ActivityCoverage } from '@reqcanvas/shared';
import { interpolateYlOrRd } from 'd3-scale-chromatic';
import type { HotspotExtensions } from '../../diagrams/workspace/ActivityHotspots';
import { CoverageBadge } from './CoverageBadges';

export type HeatmapScale = {
  colorOf: (total: number) => string;
  /** De menos a más aportes, con el rango de cada color. */
  legend: Array<{ label: string; color: string }>;
};

/** Cuantil por rango más cercano de una lista ordenada. */
const quantile = (sorted: number[], q: number) =>
  sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!;

/**
 * Escala por cuantiles del número de detalles (research R8): hasta 4 clases de amarillo a rojo
 * (`interpolateYlOrRd`), con los cortes para la leyenda.
 */
export function heatmapScale(totals: number[]): HeatmapScale {
  const sorted = [...totals].sort((a, b) => a - b);
  const breaks = sorted.length
    ? [...new Set([0.25, 0.5, 0.75, 1].map((q) => quantile(sorted, q)))]
    : [0];
  const colorAt = (index: number) =>
    interpolateYlOrRd(breaks.length === 1 ? 0.1 : 0.1 + (0.8 * index) / (breaks.length - 1));
  const legend = breaks.map((upper, index) => {
    const lower = index === 0 ? 0 : breaks[index - 1]! + 1;
    return { label: lower === upper ? `${upper}` : `${lower}–${upper}`, color: colorAt(index) };
  });
  return {
    colorOf: (total) => {
      const index = breaks.findIndex((upper) => total <= upper);
      return colorAt(index === -1 ? breaks.length - 1 : index);
    },
    legend,
  };
}

/**
 * Indicadores de la 004 sobre los puntos de extensión de la 003 (contracts/canvas-ui.md):
 * `renderBadge` con contador, marca y notas, y `colorFor` solo con la capa `heatmap` activa.
 */
export function coverageHotspots(
  coverage: ActivityCoverage[] | undefined,
  options: { heatmap: boolean; openNotes: Set<string>; toggleNotes: (key: string) => void },
): HotspotExtensions {
  if (!coverage) return {};
  const byKey = new Map(coverage.map((entry) => [entry.activityKey, entry]));
  const scale = heatmapScale(coverage.map((entry) => entry.total));
  return {
    renderBadge: (activity) => {
      const entry = byKey.get(activity.key);
      return entry ? (
        <CoverageBadge
          coverage={entry}
          notesOpen={options.openNotes.has(activity.key)}
          onToggleNotes={() => options.toggleNotes(activity.key)}
        />
      ) : null;
    },
    colorFor: options.heatmap
      ? (activity) => scale.colorOf(byKey.get(activity.key)?.total ?? 0)
      : undefined,
  };
}
