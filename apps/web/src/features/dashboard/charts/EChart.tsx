import { BarChart, GraphChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import 'echarts-wordcloud';
import { useEffect, useRef } from 'react';

echarts.use([
  BarChart,
  GraphChart,
  LineChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

/** Lo que ECharts informa al pulsar una marca. */
export type ChartClick = { seriesName?: string; name?: string; dataIndex?: number; data?: unknown };

/** Lienzo de ECharts con solo los módulos que usa el dashboard; se carga de forma diferida. */
export default function EChart({
  option,
  height,
  onClick,
}: {
  option: EChartsCoreOption;
  height: number;
  onClick?: (params: ChartClick) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const instance = echarts.init(container.current);
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    // Transiciones cortas, y ninguna si la persona pidió reducir el movimiento.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    chart.current?.setOption(
      { animation: !reduced, animationDuration: 250, animationDurationUpdate: 250, ...option },
      { notMerge: true },
    );
  }, [option]);

  useEffect(() => {
    chart.current?.resize();
  }, [height]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance || !onClick) return;
    const handler = (params: unknown) => onClick(params as ChartClick);
    instance.on('click', handler);
    return () => {
      instance.off('click', handler);
    };
  }, [onClick]);

  return <div ref={container} style={{ height, width: '100%' }} />;
}
