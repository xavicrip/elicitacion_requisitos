import type { AnalysisResults } from '@reqcanvas/shared';
import type { EChartsCoreOption } from 'echarts/core';
import { ChartFigure } from '../charts/ChartFigure';
import { escapeHtml, VIZ } from '../charts/theme';

type Network = NonNullable<AnalysisResults['cooccurrence']>;

/**
 * Las tres comunidades con más términos llevan los tres tonos validados; el resto, gris: con más
 * de tres categorías en un grafo los colores dejan de distinguirse (guía dataviz).
 */
export function graphOption(network: Network): EChartsCoreOption {
  const nodes = network.nodes ?? [];
  const sizes = new Map<number, number>();
  for (const node of nodes) sizes.set(node.community, (sizes.get(node.community) ?? 0) + 1);
  const top = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3);
  const slot = new Map(top.map(([community], index) => [community, index]));
  const categories = [...top.map((_, index) => `Comunidad ${index + 1}`), 'Otras'];
  const maxFreq = Math.max(1, ...nodes.map((node) => node.freq));
  return {
    color: [...VIZ.series, VIZ.neutral],
    legend: { top: 0, left: 0, textStyle: { color: VIZ.text } },
    tooltip: {
      formatter: (params: {
        dataType: string;
        name: string;
        value: number;
        data: { source?: string; target?: string };
      }) =>
        params.dataType === 'edge'
          ? `${escapeHtml(params.data.source ?? '')} + ${escapeHtml(params.data.target ?? '')}: <b>${params.value}</b>`
          : `${escapeHtml(params.name)}: <b>${params.value}</b>`,
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        top: 36,
        roam: true,
        force: { repulsion: 120, edgeLength: [30, 110] },
        label: { show: true, color: VIZ.text, position: 'right' },
        lineStyle: { color: VIZ.neutral, opacity: 0.7 },
        categories: categories.map((name) => ({ name })),
        data: nodes.map((node) => ({
          name: node.id,
          value: node.freq,
          symbolSize: 8 + (22 * node.freq) / maxFreq,
          category: slot.get(node.community) ?? 3,
        })),
        edges: (network.edges ?? []).map((edge) => ({
          source: edge.source,
          target: edge.target,
          value: edge.count,
          lineStyle: { width: Math.min(6, 1 + edge.count / 4) },
        })),
      },
    ],
  };
}

/** Red de términos que aparecen juntos en un mismo detalle (FR-005). */
export function CooccurrenceGraph({ network }: { network: Network }) {
  const edges = network.edges ?? [];
  if (edges.length === 0) return <p>No hay términos que aparezcan juntos con frecuencia.</p>;
  const strongest = edges[0]!;
  return (
    <ChartFigure
      title="Términos que aparecen juntos"
      description={`El par más frecuente: «${strongest.source}» y «${strongest.target}», juntos en ${strongest.count} detalles.`}
      option={graphOption(network)}
      table={{
        columns: ['Término', 'Término', 'Detalles en común'],
        rows: edges.slice(0, 30).map((edge) => [edge.source, edge.target, edge.count]),
      }}
      height={420}
    />
  );
}
