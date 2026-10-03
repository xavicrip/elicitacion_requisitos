import type { ExportRow } from '../../src/modules/exports/query';

/** Fila de exportación para las pruebas de formato (feature 008). */
export function exportRow(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    id: '66f200000000000000a1b2c3',
    shortId: '00a1b2c3',
    diagramId: '66f100000000000000000001',
    diagramName: 'Proceso de compra',
    activityKey: 'act-04',
    activityLabel: 'Validar pago',
    given: 'el cliente tiene productos en el carrito',
    when: 'paga con tarjeta',
    then: 'el sistema confirma el pago en menos de 5 segundos',
    type: 'non_functional',
    priority: 'must',
    authorRole: 'Cajero',
    tags: ['pagos', 'tarjeta'],
    status: 'validated',
    duplicateOfShortId: null,
    discardReason: null,
    voteCount: 3,
    commentCount: 1,
    authorName: 'Ana Pérez',
    createdAt: new Date('2026-10-01T15:00:00.000Z'),
    updatedAt: new Date('2026-10-02T04:30:00.000Z'),
    ...overrides,
  };
}

export async function* asRows(rows: ExportRow[]): AsyncGenerator<ExportRow> {
  for (const row of rows) yield row;
}

/** Recoge un stream en un Buffer. */
export async function collect(stream: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
