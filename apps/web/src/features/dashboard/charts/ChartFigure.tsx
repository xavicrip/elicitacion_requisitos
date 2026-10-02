import type { EChartsCoreOption } from 'echarts/core';
import { lazy, Suspense, useId, type ReactNode } from 'react';

const EChart = lazy(() => import('./EChart'));

export type TableData = { columns: string[]; rows: Array<Array<string | number>> };

/**
 * Un gráfico con su título y su tabla alternativa (guía dataviz: la identidad nunca depende solo
 * del color y siempre hay una vista de tabla). El lienzo es decorativo para lectores de pantalla:
 * la descripción y la tabla llevan la información.
 */
export function ChartFigure({
  title,
  description,
  option,
  table,
  height = 240,
  children,
}: {
  title: string;
  description: string;
  option: EChartsCoreOption;
  table: TableData;
  height?: number;
  children?: ReactNode;
}) {
  const titleId = useId();
  return (
    <figure aria-labelledby={titleId} className="space-y-2 rounded border p-3">
      <figcaption id={titleId} className="font-semibold">
        {title}
      </figcaption>
      <p className="text-sm text-gray-600">{description}</p>
      <div aria-hidden="true">
        <Suspense fallback={<div style={{ height }} />}>
          <EChart option={option} height={height} />
        </Suspense>
      </div>
      {children}
      <details>
        <summary className="cursor-pointer text-sm underline">Ver los datos en una tabla</summary>
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th key={column} scope="col" className="border-b py-1 pr-3 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) =>
                  cellIndex === 0 ? (
                    <th key={cellIndex} scope="row" className="py-1 pr-3 font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={cellIndex} className="py-1 pr-3 tabular-nums">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
