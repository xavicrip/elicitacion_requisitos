import type { AnalysisResults } from '@reqcanvas/shared';
import type { EChartsCoreOption } from 'echarts/core';
import { ChartFigure } from '../charts/ChartFigure';
import { escapeHtml, VIZ } from '../charts/theme';
import { DetailSnippet, type Lookup } from '../text/lookup';

type SentimentData = NonNullable<AnalysisResults['sentiment']>;
type ByActivity = NonNullable<SentimentData['byActivity']>;

const SERIES = [
  { key: 'neg', name: 'Negativo', color: VIZ.diverging.negative },
  { key: 'neu', name: 'Neutro', color: VIZ.diverging.midpoint },
  { key: 'pos', name: 'Positivo', color: VIZ.diverging.positive },
] as const;
const percent = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 0 });

/** Barras apiladas por actividad: una escala ordenada con el neutro en gris (guía dataviz). */
export function sentimentOption(byActivity: ByActivity, lookup: Lookup): EChartsCoreOption {
  return {
    color: SERIES.map((series) => series.color),
    legend: { top: 0, left: 0, textStyle: { color: VIZ.text } },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: Array<{ axisValueLabel: string; seriesName: string; value: number }>) =>
        [
          `<b>${escapeHtml(params[0]?.axisValueLabel ?? '')}</b>`,
          ...params.map((item) => `${escapeHtml(item.seriesName)}: ${item.value}`),
        ].join('<br>'),
    },
    xAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: VIZ.textSecondary },
      splitLine: { lineStyle: { color: VIZ.grid } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: byActivity.map((entry) => lookup.activityLabel(entry.activityKey)),
      axisLabel: { color: VIZ.text, width: 150, overflow: 'truncate' },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: SERIES.map(({ key, name }) => ({
      type: 'bar',
      name,
      stack: 'sentimiento',
      barMaxWidth: 18,
      // Separación de 2 px entre segmentos, del color de la superficie.
      itemStyle: { borderColor: VIZ.surface, borderWidth: 1 },
      data: byActivity.map((entry) => entry[key]),
    })),
  };
}

/**
 * Sentimiento de los aportes (US4-1): distribución por actividad y los detalles con más malestar
 * expresado. Solo se cuenta como negativo lo que el modelo señala con claridad.
 */
export function Sentiment({ sentiment, lookup }: { sentiment: SentimentData; lookup: Lookup }) {
  const byActivity = sentiment.byActivity ?? [];
  const negatives = sentiment.mostNegative ?? [];
  const total = byActivity.reduce((sum, entry) => sum + entry.neg + entry.neu + entry.pos, 0);
  const negative = byActivity.reduce((sum, entry) => sum + entry.neg, 0);
  if (byActivity.length === 0) return <p>No hay detalles que analizar.</p>;
  return (
    <div className="space-y-3">
      <ChartFigure
        title="Sentimiento por actividad"
        description={
          negative === 0
            ? 'Ningún detalle expresa malestar con claridad.'
            : `${negative} de ${total} detalles expresan malestar.`
        }
        option={sentimentOption(byActivity, lookup)}
        table={{
          columns: ['Actividad', ...SERIES.map((series) => series.name)],
          rows: byActivity.map((entry) => [
            lookup.activityLabel(entry.activityKey),
            entry.neg,
            entry.neu,
            entry.pos,
          ]),
        }}
        height={Math.max(140, 34 * byActivity.length + 60)}
      />
      {negatives.length > 0 && (
        <section aria-label="Detalles más negativos" className="space-y-1">
          <h3 className="font-semibold">Detalles con más malestar expresado</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {negatives.map((item) => (
              <li key={item.detailId}>
                <span className="text-gray-600">{percent.format(item.score)} negativo · </span>
                <DetailSnippet id={item.detailId} lookup={lookup} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
