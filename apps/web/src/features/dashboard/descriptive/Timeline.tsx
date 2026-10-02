import type { DescriptiveDashboard } from '@reqcanvas/shared';
import type { EChartsCoreOption } from 'echarts/core';
import { ChartFigure } from '../charts/ChartFigure';
import { escapeHtml, VIZ } from '../charts/theme';

const SERIES = [
  { key: 'created', name: 'Detalles creados' },
  { key: 'votes', name: 'Votos' },
  { key: 'comments', name: 'Comentarios' },
] as const;

const day = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const label = (date: string) => day.format(new Date(`${date}T00:00:00Z`));

/** Tres series con la misma escala (un solo eje): leyenda y etiqueta final de cada línea. */
export function timelineOption(timeline: DescriptiveDashboard['timeline']): EChartsCoreOption {
  return {
    color: [...VIZ.series],
    grid: { left: 8, right: 110, top: 36, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, textStyle: { color: VIZ.text } },
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ axisValueLabel: string; seriesName: string; value: number }>) =>
        [
          `<b>${escapeHtml(params[0]?.axisValueLabel ?? '')}</b>`,
          ...params.map((item) => `${escapeHtml(item.seriesName)}: ${item.value}`),
        ].join('<br>'),
    },
    xAxis: {
      type: 'category',
      data: timeline.map((entry) => label(entry.date)),
      axisLabel: { color: VIZ.textSecondary },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: VIZ.textSecondary },
      splitLine: { lineStyle: { color: VIZ.grid } },
    },
    series: SERIES.map(({ key, name }) => ({
      type: 'line',
      name,
      data: timeline.map((entry) => entry[key]),
      lineStyle: { width: 2 },
      symbolSize: 8,
      endLabel: { show: true, formatter: name, color: VIZ.text },
    })),
  };
}

/** Evolución de los aportes en el tiempo (US1), por día del proyecto. */
export function Timeline({ timeline }: { timeline: DescriptiveDashboard['timeline'] }) {
  const total = timeline.reduce((sum, entry) => sum + entry.created, 0);
  return (
    <ChartFigure
      title="Aportes en el tiempo"
      description={
        timeline.length
          ? `${total} detalles creados entre el ${label(timeline[0]!.date)} y el ${label(timeline.at(-1)!.date)}.`
          : 'Sin aportes con estos filtros.'
      }
      option={timelineOption(timeline)}
      table={{
        columns: ['Día', ...SERIES.map((series) => series.name)],
        rows: timeline.map((entry) => [entry.date, entry.created, entry.votes, entry.comments]),
      }}
      height={260}
    />
  );
}
