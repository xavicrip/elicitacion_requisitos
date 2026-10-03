import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { COLUMNS } from '../../src/modules/exports/columns';
import { csvStream } from '../../src/modules/exports/csv';
import type { ExportRow } from '../../src/modules/exports/query';
import { asRows, collect, exportRow } from '../helpers/export-rows';

// US1 de la 008 (FR-002, FR-003; research R1 y R2; contracts/export-formats.md).

const HEADERS = [
  'ID',
  'Diagrama',
  'Actividad',
  'Dado',
  'Cuando',
  'Entonces',
  'Tipo',
  'Prioridad',
  'Rol',
  'Etiquetas',
  'Estado',
  'Duplicado de',
  'Motivo de descarte',
  'Votos',
  'Comentarios',
  'Autor',
  'Creado',
  'Actualizado',
];

async function csv(rows: ExportRow[], delimiter?: 'comma' | 'semicolon') {
  const buffer = await collect(csvStream(asRows(rows), delimiter));
  const text = buffer.toString('utf8');
  const records = parse(buffer, {
    bom: true,
    delimiter: delimiter === 'semicolon' ? ';' : ',',
    record_delimiter: '\r\n',
  }) as string[][];
  return { buffer, text, records };
}

describe('formato', () => {
  it('las 18 columnas del contrato, en orden', async () => {
    expect(COLUMNS.map((column) => column.header)).toEqual(HEADERS);
    const { records } = await csv([exportRow()]);
    expect(records[0]).toEqual(HEADERS);
    expect(records[1]).toEqual([
      '00a1b2c3',
      'Proceso de compra',
      'Validar pago',
      'el cliente tiene productos en el carrito',
      'paga con tarjeta',
      'el sistema confirma el pago en menos de 5 segundos',
      'No funcional',
      'Must',
      'Cajero',
      'pagos; tarjeta',
      'Validado',
      '',
      '',
      '3',
      '1',
      'Ana Pérez',
      '2026-10-01T15:00:00.000Z',
      '2026-10-02T04:30:00.000Z',
    ]);
  });

  it('UTF-8 con BOM, saltos \\r\\n y todos los campos entre comillas', async () => {
    const { buffer, text } = await csv([exportRow({ priority: null, authorRole: null })]);
    expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = text.slice(1).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('');
    for (const line of lines.slice(0, 2)) {
      expect(line.split('","')).toHaveLength(18);
      expect(line.startsWith('"') && line.endsWith('"')).toBe(true);
    }
    // Los vacíos también van entrecomillados.
    expect(lines[1]).toContain(',"",');
  });

  it('con semicolon el delimitador es punto y coma', async () => {
    const { text, records } = await csv([exportRow()], 'semicolon');
    expect(text).toContain('"ID";"Diagrama"');
    expect(records[1]![2]).toBe('Validar pago');
  });

  it('sin detalles, solo los encabezados', async () => {
    const { records } = await csv([]);
    expect(records).toEqual([HEADERS]);
  });
});

describe('contenido', () => {
  it('tildes, ñ, comas, comillas y saltos de línea: una fila por detalle', async () => {
    const given = 'el señor Núñez dijo "pagaré mañana", y añadió:\nprimero\r\nsegundo';
    const { records } = await csv([
      exportRow({ given }),
      exportRow({ when: 'coma, punto; y "comillas"' }),
    ]);
    expect(records).toHaveLength(3);
    expect(records[1]![3]).toBe(given);
    expect(records[2]![4]).toBe('coma, punto; y "comillas"');
  });

  it('traduce tipo, prioridad y estado, y marca la actividad huérfana y el duplicado', async () => {
    const { records } = await csv([
      exportRow({ type: 'functional', priority: 'wont', status: 'pending', activityLabel: null }),
      exportRow({
        type: 'business_rule',
        priority: 'should',
        status: 'duplicate',
        duplicateOfShortId: 'abcd1234',
      }),
      exportRow({
        type: 'constraint',
        priority: 'could',
        status: 'discarded',
        discardReason: 'Fuera de alcance',
      }),
    ]);
    const pick = (record: string[]) => [
      record[2],
      record[6],
      record[7],
      record[10],
      record[11],
      record[12],
    ];
    expect(pick(records[1]!)).toEqual(['(huérfano)', 'Funcional', "Won't", 'Pendiente', '', '']);
    expect(pick(records[2]!)).toEqual([
      'Validar pago',
      'Regla de negocio',
      'Should',
      'Duplicado',
      'abcd1234',
      '',
    ]);
    expect(pick(records[3]!)).toEqual([
      'Validar pago',
      'Restricción',
      'Could',
      'Descartado',
      '',
      'Fuera de alcance',
    ]);
  });

  it('neutraliza las fórmulas en todas las celdas de texto (FR-003)', async () => {
    const formula = '=HYPERLINK("http://x","clic")';
    const { records } = await csv([
      exportRow({
        diagramName: '+diagrama',
        activityLabel: '-actividad',
        given: formula,
        when: '@cuando',
        then: '\tentonces',
        authorRole: '=rol',
        tags: ['=etiqueta', 'otra'],
        discardReason: '+motivo',
        authorName: '=autor',
      }),
    ]);
    const record = records[1]!;
    for (const index of [1, 2, 3, 4, 5, 8, 9, 12, 15]) {
      expect(record[index]!.startsWith("'"), `columna ${HEADERS[index]}`).toBe(true);
    }
    expect(record[3]).toBe(`'${formula}`);
    // Los números y las fechas no son texto libre.
    expect(record[13]).toBe('3');
    expect(record[16]).toBe('2026-10-01T15:00:00.000Z');
  });
});
