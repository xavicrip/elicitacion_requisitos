import type { AnalysisResults } from '@reqcanvas/shared';
import type { EChartsCoreOption } from 'echarts/core';
import { useCallback, useState } from 'react';
import { ChartFigure } from '../charts/ChartFigure';
import type { ChartClick } from '../charts/EChart';
import { escapeHtml, VIZ } from '../charts/theme';
import { DetailSnippet, type Lookup } from './lookup';

type ClusterData = NonNullable<AnalysisResults['clusters']>;
type Point = NonNullable<ClusterData['points']>[number];

const SERIES = ['En un grupo', 'Grupo seleccionado', 'Sin grupo'] as const;

/** Tres series fijas (en grupo, grupo seleccionado, sin grupo): el color no depende del grupo. */
export function scatterOption(points: Point[], selected: string | null): EChartsCoreOption {
  const of = (name: (typeof SERIES)[number]) =>
    points
      .filter((point) =>
        name === 'Sin grupo'
          ? point.groupId === null
          : name === 'Grupo seleccionado'
            ? point.groupId !== null && point.groupId === selected
            : point.groupId !== null && point.groupId !== selected,
      )
      .map((point) => ({ value: [point.x, point.y], groupId: point.groupId }));
  return {
    color: [VIZ.series[0], VIZ.series[1], VIZ.neutral],
    legend: { top: 0, left: 0, textStyle: { color: VIZ.text } },
    grid: { left: 8, right: 8, top: 36, bottom: 8 },
    xAxis: { type: 'value', scale: true, show: false },
    yAxis: { type: 'value', scale: true, show: false },
    tooltip: {
      formatter: (params: { seriesName: string }) => escapeHtml(params.seriesName),
    },
    series: SERIES.map((name) => ({
      type: 'scatter',
      name,
      symbolSize: name === 'Grupo seleccionado' ? 12 : 8,
      itemStyle: { borderColor: VIZ.surface, borderWidth: 1 },
      data: of(name),
    })),
  };
}

/**
 * Grupos de requisitos similares (US2-4): el mapa sitúa cerca los detalles parecidos; al elegir
 * un grupo (en el mapa o en la lista) se ven sus detalles y el acceso a cada uno.
 */
export function Clusters({ clusters, lookup }: { clusters: ClusterData; lookup: Lookup }) {
  const groups = clusters.groups ?? [];
  const points = clusters.points ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const onClick = useCallback((params: ChartClick) => {
    const groupId = (params.data as { groupId?: string | null } | undefined)?.groupId;
    if (groupId) setSelected(groupId);
  }, []);
  if (groups.length === 0) return <p>No se encontraron grupos de requisitos similares.</p>;
  const current = groups.find((group) => group.id === selected);
  const grouped = points.filter((point) => point.groupId !== null).length;
  return (
    <div className="space-y-3">
      <ChartFigure
        title="Mapa de requisitos similares"
        description={`${groups.length} grupos reúnen ${grouped} de los ${points.length} detalles; los puntos cercanos son requisitos parecidos.`}
        option={scatterOption(points, selected)}
        table={{
          columns: ['Grupo', 'Detalles'],
          rows: groups.map((group, index) => [`Grupo ${index + 1}`, group.detailIds.length]),
        }}
        height={360}
        onClick={onClick}
      />
      <ul aria-label="Grupos" className="flex flex-wrap gap-2">
        {groups.map((group, index) => (
          <li key={group.id}>
            <button
              type="button"
              aria-pressed={group.id === selected}
              onClick={() => setSelected(group.id)}
              className={`rounded border px-2 py-1 text-sm ${
                group.id === selected ? 'border-gray-900 font-semibold' : ''
              }`}
            >
              Grupo {index + 1} · {group.detailIds.length} detalles
            </button>
          </li>
        ))}
      </ul>
      {current && (
        <section aria-label="Detalles del grupo" className="rounded bg-gray-50 p-3 text-sm">
          <ul className="list-disc space-y-1 pl-5">
            {current.detailIds.map((id) => (
              <li key={id} className={id === current.representativeId ? 'font-medium' : ''}>
                <DetailSnippet id={id} lookup={lookup} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
