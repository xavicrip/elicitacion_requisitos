import type { AnalysisResults } from '@reqcanvas/shared';
import type { EChartsCoreOption } from 'echarts/core';
import { ChartFigure } from '../charts/ChartFigure';
import { escapeHtml, VIZ } from '../charts/theme';

type Terms = NonNullable<NonNullable<AnalysisResults['keywords']>['wordCloud']>;

export function wordCloudOption(terms: Terms): EChartsCoreOption {
  return {
    tooltip: {
      formatter: (params: { name: string; value: number }) =>
        `${escapeHtml(params.name)}: <b>${params.value}</b>`,
    },
    series: [
      {
        type: 'wordCloud',
        shape: 'circle',
        sizeRange: [12, 44],
        rotationRange: [0, 0],
        gridSize: 6,
        // Un solo tono: el tamaño lleva la frecuencia; el color no codifica nada.
        textStyle: { color: VIZ.series[0] },
        data: terms.map((term) => ({ name: term.term, value: term.weight })),
      },
    ],
  };
}

/** Nube de las palabras más frecuentes de todos los detalles (FR-005). */
export function WordCloud({ terms }: { terms: Terms }) {
  if (terms.length === 0) return <p>No hay palabras que mostrar.</p>;
  return (
    <ChartFigure
      title="Palabras más frecuentes"
      description={`La más frecuente: «${terms[0]!.term}», en ${terms[0]!.weight} ocasiones.`}
      option={wordCloudOption(terms)}
      table={{ columns: ['Palabra', 'Apariciones'], rows: terms.map((t) => [t.term, t.weight]) }}
      height={320}
    />
  );
}
