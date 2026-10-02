import type { DescriptiveDashboard } from '@reqcanvas/shared';

const number = new Intl.NumberFormat('es');
const percent = (value: number) => `${number.format(value)} %`;

/** Indicadores clave (US1): fichas de dato, no gráficos (guía dataviz). */
export function KpiTiles({ kpis }: { kpis: DescriptiveDashboard['kpis'] }) {
  const tiles = [
    { label: 'Detalles', value: number.format(kpis.totalDetails) },
    { label: 'Participantes activos', value: number.format(kpis.activeParticipants) },
    { label: 'Actividades cubiertas', value: percent(kpis.coveredActivitiesPct) },
    { label: 'Detalles validados', value: percent(kpis.validatedPct) },
  ];
  return (
    <dl aria-label="Indicadores clave" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded border p-3">
          <dt className="text-sm text-gray-600">{tile.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
