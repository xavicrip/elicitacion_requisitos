import { Readable } from 'node:stream';
import type { ExportOptions } from '@reqcanvas/shared';
import { stringify } from 'csv-stringify';
import { COLUMNS } from './columns.js';
import type { ExportRow } from './query.js';
import { neutralizeFormula } from './sanitize.js';

const DELIMITER = { comma: ',', semicolon: ';' } as const;

function cells(row: ExportRow): string[] {
  return COLUMNS.map((column) => {
    const value = column.value(row);
    if (value instanceof Date) return value.toISOString();
    return column.kind === 'text' ? neutralizeFormula(String(value)) : String(value);
  });
}

async function* records(rows: AsyncIterable<ExportRow>): AsyncGenerator<string[]> {
  yield COLUMNS.map((column) => column.header);
  for await (const row of rows) yield cells(row);
}

/**
 * CSV para hojas de cálculo (research R1): UTF-8 con BOM, `\r\n`, todos los campos entre
 * comillas (los saltos de línea de un texto quedan dentro de su celda) y fórmulas neutralizadas.
 * En streaming: una fila por detalle a medida que llega del cursor.
 */
export function csvStream(
  rows: AsyncIterable<ExportRow>,
  delimiter: ExportOptions['delimiter'] = 'comma',
): Readable {
  return Readable.from(records(rows)).pipe(
    stringify({
      bom: true,
      delimiter: DELIMITER[delimiter],
      record_delimiter: '\r\n',
      quoted: true,
      quoted_empty: true,
    }),
  );
}
