import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { ExportRow } from '../../src/modules/exports/query';
import { writeXlsx } from '../../src/modules/exports/xlsx';
import { asRows, collect, exportRow } from '../helpers/export-rows';

// US1 de la 008 (FR-002, FR-003; research R2 y R3): el libro se lee de vuelta con exceljs.

async function workbook(rows: ExportRow[], timeZone = 'America/Guayaquil') {
  const output = new PassThrough();
  const [buffer] = await Promise.all([collect(output), writeXlsx(asRows(rows), output, timeZone)]);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as never);
  return book;
}

const values = (row: ExcelJS.Row) => (row.values as unknown[]).slice(1);

describe('hoja Requisitos', () => {
  it('encabezados congelados, autofiltro y las 18 columnas', async () => {
    const book = await workbook([exportRow()]);
    const sheet = book.getWorksheet('Requisitos')!;
    expect(values(sheet.getRow(1))).toHaveLength(18);
    expect(values(sheet.getRow(1)).slice(0, 4)).toEqual(['ID', 'Diagrama', 'Actividad', 'Dado']);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
    expect(sheet.rowCount).toBe(2);
  });

  it('texto como cadena, votos y comentarios numéricos y fechas en la zona del proyecto', async () => {
    const book = await workbook([exportRow()]);
    const row = book.getWorksheet('Requisitos')!.getRow(2);
    expect(row.getCell(1).value).toBe('00a1b2c3');
    expect(row.getCell(7).value).toBe('No funcional');
    expect(row.getCell(10).value).toBe('pagos; tarjeta');
    expect(row.getCell(14).value).toBe(3);
    expect(row.getCell(15).value).toBe(1);
    // 15:00 UTC son las 10:00 en Guayaquil; 04:30 UTC del día 2 son las 23:30 del día 1.
    expect((row.getCell(17).value as Date).toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect((row.getCell(18).value as Date).toISOString()).toBe('2026-10-01T23:30:00.000Z');
    expect(row.getCell(17).numFmt).toBe('yyyy-mm-dd hh:mm');
  });

  it('una fórmula queda como texto literal (FR-003)', async () => {
    const formula = '=HYPERLINK("http://x","clic")';
    const book = await workbook([exportRow({ given: formula, authorName: '+autor' })]);
    const row = book.getWorksheet('Requisitos')!.getRow(2);
    expect(row.getCell(4).type).toBe(ExcelJS.ValueType.String);
    expect(row.getCell(4).value).toBe(`'${formula}`);
    expect(row.getCell(4).formula).toBeUndefined();
    expect(row.getCell(16).value).toBe("'+autor");
  });

  it('sin detalles, solo los encabezados', async () => {
    const book = await workbook([]);
    expect(book.getWorksheet('Requisitos')!.rowCount).toBe(1);
  });

  it('tildes, ñ y saltos de línea se conservan en una sola fila', async () => {
    const given = 'el señor Núñez\nañadió una línea';
    const book = await workbook([exportRow({ given }), exportRow()]);
    const sheet = book.getWorksheet('Requisitos')!;
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(2).getCell(4).value).toBe(given);
  });
});

describe('hoja Resumen', () => {
  it('cuenta los requisitos por actividad y por tipo', async () => {
    const book = await workbook([
      exportRow(),
      exportRow({ type: 'functional' }),
      exportRow({ activityLabel: 'Emitir factura', type: 'functional' }),
      exportRow({ activityLabel: null }),
    ]);
    const rows: unknown[][] = [];
    book.getWorksheet('Resumen')!.eachRow((row) => rows.push(values(row)));
    expect(rows).toEqual([
      ['Por actividad', 'Requisitos'],
      ['Proceso de compra · Validar pago', 2],
      ['Proceso de compra · Emitir factura', 1],
      ['Proceso de compra · (huérfano)', 1],
      ['Por tipo', 'Requisitos'],
      ['No funcional', 2],
      ['Funcional', 2],
    ]);
  });
});
