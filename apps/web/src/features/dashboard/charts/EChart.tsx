import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

/** Lienzo de ECharts con solo los módulos que usa el dashboard; se carga de forma diferida. */
export default function EChart({ option, height }: { option: EChartsCoreOption; height: number }) {
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

  return <div ref={container} style={{ height, width: '100%' }} />;
}
