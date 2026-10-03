import type { DetailStatus, DetailType, Priority } from '@reqcanvas/shared';
import type { ExportRow } from './query.js';

/** Etiquetas en español de los valores de un detalle (contracts/export-formats.md). */
export const TYPE_LABEL: Record<DetailType, string> = {
  functional: 'Funcional',
  non_functional: 'No funcional',
  business_rule: 'Regla de negocio',
  constraint: 'Restricción',
};
export const PRIORITY_LABEL: Record<Priority, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: "Won't",
};
export const STATUS_LABEL: Record<DetailStatus, string> = {
  pending: 'Pendiente',
  validated: 'Validado',
  duplicate: 'Duplicado',
  discarded: 'Descartado',
};
export const ORPHAN_ACTIVITY = '(huérfano)';

export type Column = {
  header: string;
  /** `text` pasa por `neutralizeFormula`; `number` y `date` conservan su tipo en Excel. */
  kind: 'text' | 'number' | 'date';
  /** Ancho de la columna en Excel, en caracteres. */
  width: number;
  value: (row: ExportRow) => string | number | Date;
};

/** Las 18 columnas de CSV y Excel, en el orden del contrato. */
export const COLUMNS: readonly Column[] = [
  { header: 'ID', kind: 'text', width: 10, value: (row) => row.shortId },
  { header: 'Diagrama', kind: 'text', width: 24, value: (row) => row.diagramName },
  {
    header: 'Actividad',
    kind: 'text',
    width: 24,
    value: (row) => row.activityLabel ?? ORPHAN_ACTIVITY,
  },
  { header: 'Dado', kind: 'text', width: 40, value: (row) => row.given },
  { header: 'Cuando', kind: 'text', width: 40, value: (row) => row.when },
  { header: 'Entonces', kind: 'text', width: 40, value: (row) => row.then },
  { header: 'Tipo', kind: 'text', width: 16, value: (row) => TYPE_LABEL[row.type] },
  {
    header: 'Prioridad',
    kind: 'text',
    width: 10,
    value: (row) => (row.priority ? PRIORITY_LABEL[row.priority] : ''),
  },
  { header: 'Rol', kind: 'text', width: 18, value: (row) => row.authorRole ?? '' },
  { header: 'Etiquetas', kind: 'text', width: 24, value: (row) => row.tags.join('; ') },
  { header: 'Estado', kind: 'text', width: 12, value: (row) => STATUS_LABEL[row.status] },
  { header: 'Duplicado de', kind: 'text', width: 12, value: (row) => row.duplicateOfShortId ?? '' },
  {
    header: 'Motivo de descarte',
    kind: 'text',
    width: 30,
    value: (row) => row.discardReason ?? '',
  },
  { header: 'Votos', kind: 'number', width: 8, value: (row) => row.voteCount },
  { header: 'Comentarios', kind: 'number', width: 12, value: (row) => row.commentCount },
  { header: 'Autor', kind: 'text', width: 22, value: (row) => row.authorName },
  { header: 'Creado', kind: 'date', width: 18, value: (row) => row.createdAt },
  { header: 'Actualizado', kind: 'date', width: 18, value: (row) => row.updatedAt },
];
