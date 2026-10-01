import type { HeatmapScale } from './Heatmap';

/** Leyenda del mapa de calor: número de requisitos por color. */
export function HeatmapLegend({ legend }: { legend: HeatmapScale['legend'] }) {
  return (
    <ul
      aria-label="Leyenda del mapa de calor"
      className="flex flex-wrap items-center gap-2 text-xs"
    >
      {legend.map((item) => (
        <li key={item.label} className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-5 rounded"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
      <li className="text-gray-600">requisitos por actividad</li>
    </ul>
  );
}
