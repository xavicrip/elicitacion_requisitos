import { PassThrough, type Readable } from 'node:stream';
import type { ExportFormat, ExportOptions } from '@reqcanvas/shared';
import { csvStream } from './csv.js';
import type { ExportRow } from './query.js';
import { writeXlsx } from './xlsx.js';

/** Formatos que genera `api` (el PDF lo genera `analytics-worker`). */
export type FileFormat = Exclude<ExportFormat, 'pdf'>;

export const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  gherkin: 'application/zip',
  pdf: 'application/pdf',
};

export const EXTENSION: Record<ExportFormat, string> = {
  csv: 'csv',
  xlsx: 'xlsx',
  gherkin: 'zip',
  pdf: 'pdf',
};

/** Formatos que `api` ya sabe generar; cada historia de la 008 añade el suyo. */
export const isFileFormat = (format: ExportFormat): format is 'csv' | 'xlsx' =>
  format === 'csv' || format === 'xlsx';

/** El archivo de una exportación, en streaming a medida que llegan las filas. */
export function renderExport(
  format: 'csv' | 'xlsx',
  rows: AsyncIterable<ExportRow>,
  options: ExportOptions,
  timeZone: string,
): Readable {
  if (format === 'csv') return csvStream(rows, options.delimiter);
  const output = new PassThrough();
  writeXlsx(rows, output, timeZone).catch((error: Error) => output.destroy(error));
  return output;
}
