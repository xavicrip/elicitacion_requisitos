import type { DescriptiveDashboard } from '@reqcanvas/shared';
import type { EChartsCoreOption } from 'echarts/core';
import { ChartFigure } from '../charts/ChartFigure';
import { escapeHtml, VIZ } from '../charts/theme';

type Count = DescriptiveDashboard['byType'][number];

/**
 * Barras horizontales de una sola serie (magnitud: un tono, sin leyenda) con el valor a la
 * vista. El tooltip escapa el nombre: puede ser texto escrito por usuarios.
 */
export function barOption(items: Count[]): EChartsCoreOption {
  return {
    grid: { left: 8, right: 36, top: 8, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: VIZ.textSecondary },
      splitLine: { lineStyle: { color: VIZ.grid } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: items.map((item) => item.label),
      axisLabel: { color: VIZ.text, width: 150, overflow: 'truncate' },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: { name: string; value: number }) =>
        `${escapeHtml(params.name)}: <b>${params.value}</b>`,
    },
    series: [
      {
        type: 'bar',
        data: items.map((item) => item.count),
        barMaxWidth: 18,
        itemStyle: { color: VIZ.series[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: VIZ.text },
      },
    ],
  };
}

const CHARTS: Array<{
  key: 'byActivity' | 'byType' | 'byPriority' | 'byRole' | 'byStatus';
  title: string;
  column: string;
}> = [
  { key: 'byActivity', title: 'Detalles por actividad', column: 'Actividad' },
  { key: 'byType', title: 'Detalles por tipo', column: 'Tipo' },
  { key: 'byPriority', title: 'Detalles por prioridad', column: 'Prioridad' },
  { key: 'byRole', title: 'Detalles por rol de quien aporta', column: 'Rol' },
  { key: 'byStatus', title: 'Detalles por estado', column: 'Estado' },
];

/** Distribuciones del levantamiento (US1, FR-002). */
export function Distributions({ data }: { data: DescriptiveDashboard }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {CHARTS.map(({ key, title, column }) => {
        const items = data[key];
        const top = [...items].sort((a, b) => b.count - a.count)[0];
        return (
          <ChartFigure
            key={key}
            title={title}
            description={
              top && top.count > 0
                ? `El mayor: ${top.label}, con ${top.count}.`
                : 'Sin detalles con estos filtros.'
            }
            option={barOption(items)}
            table={{
              columns: [column, 'Detalles'],
              rows: items.map((item) => [item.label, item.count]),
            }}
            height={Math.max(120, 34 * items.length + 30)}
          />
        );
      })}
    </div>
  );
}
