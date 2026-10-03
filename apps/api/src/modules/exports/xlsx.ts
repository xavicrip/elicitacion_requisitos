import type { Writable } from 'node:stream';
import ExcelJS from 'exceljs';
import { offsetMs } from '../dashboard/filters.js';
import { COLUMNS, ORPHAN_ACTIVITY, TYPE_LABEL } from './columns.js';
import type { ExportRow } from './query.js';
import { neutralizeFormula } from './sanitize.js';

const DATE_FORMAT = 'yyyy-mm-dd hh:mm';

/** Excel no tiene zonas horarias: se escribe la hora local del proyecto como si fuera UTC. */
const zoned = (date: Date, timeZone: string) => new Date(date.getTime() + offsetMs(date, timeZone));

/**
 * Libro de Excel en streaming (research R3): hoja «Requisitos» con encabezados congelados y
 * autofiltro, y hoja «Resumen» con los conteos por actividad y por tipo. El texto se escribe
 * siempre como cadena y con las fórmulas neutralizadas.
 */
export async function writeXlsx(
  rows: AsyncIterable<ExportRow>,
  output: Writable,
  timeZone: string,
): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true });
  workbook.creator = 'ReqCanvas';

  const sheet = workbook.addWorksheet('Requisitos', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = COLUMNS.map((column) => ({
    header: column.header,
    width: column.width,
    ...(column.kind === 'date' ? { style: { numFmt: DATE_FORMAT } } : {}),
  }));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  sheet.getRow(1).font = { bold: true };

  const byActivity = new Map<string, number>();
  const byType = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

  for await (const row of rows) {
    sheet
      .addRow(
        COLUMNS.map((column) => {
          const value = column.value(row);
          if (value instanceof Date) return zoned(value, timeZone);
          return column.kind === 'text' ? neutralizeFormula(String(value)) : value;
        }),
      )
      .commit();
    bump(byActivity, `${row.diagramName} · ${row.activityLabel ?? ORPHAN_ACTIVITY}`);
    bump(byType, TYPE_LABEL[row.type]);
  }
  sheet.commit();

  const summary = workbook.addWorksheet('Resumen');
  summary.columns = [{ width: 48 }, { width: 12 }];
  const section = (title: string, counts: Map<string, number>) => {
    summary.addRow([title, 'Requisitos']).font = { bold: true };
    for (const [label, count] of counts) summary.addRow([neutralizeFormula(label), count]);
    summary.addRow([]);
  };
  section('Por actividad', byActivity);
  section('Por tipo', byType);
  summary.commit();

  await workbook.commit();
}
