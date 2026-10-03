import type { DetailStatus, DetailType } from '@reqcanvas/shared';
import { ZipArchive } from 'archiver';
import type { Readable } from 'node:stream';
import { ORPHAN_ACTIVITY } from './columns.js';
import type { ExportRow } from './query.js';
import { safeFileName, uniqueNames } from './sanitize.js';

/** Etiquetas de Gherkin para el tipo y el estado de un detalle (research R4). */
const TYPE_TAG: Record<DetailType, string> = {
  functional: 'funcional',
  non_functional: 'no-funcional',
  business_rule: 'regla-de-negocio',
  constraint: 'restriccion',
};
const STATUS_TAG: Record<DetailStatus, string> = {
  pending: 'pendiente',
  validated: 'validado',
  duplicate: 'duplicado',
  discarded: 'descartado',
};

const NAME_WORDS = 8;
const EMPTY_TEXT = '(sin texto)';
export const README_NAME = 'LEEME.txt';
const README =
  'No hay requisitos que exportar a Gherkin con estos filtros.\r\n' +
  'Solo se exportan los requisitos validados; marca «Incluir pendientes» para añadir los ' +
  'pendientes.\r\n';

/** Un texto de varias líneas, en una sola: Gherkin lee cada paso en su línea. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim() || EMPTY_TEXT;

const tag = (value: string) => safeFileName(value, '');

function scenarioTags(row: ExportRow): string {
  const tags = [
    row.priority ?? '',
    TYPE_TAG[row.type],
    ...row.tags.map(tag),
    STATUS_TAG[row.status],
  ].filter(Boolean);
  return [...new Set(tags)].map((name) => `@${name}`).join(' ');
}

/**
 * El `.feature` de una actividad: una *Característica* con un *Escenario* por detalle. Las filas
 * son las de una misma actividad.
 */
export function renderFeature(rows: readonly ExportRow[]): string {
  const [first] = rows;
  if (!first) return '';
  const activity = oneLine(first.activityLabel ?? ORPHAN_ACTIVITY);
  const diagram = oneLine(first.diagramName);
  const names = rows.map((row) => oneLine(row.then).split(' ').slice(0, NAME_WORDS).join(' '));
  const repeated = new Set(names.filter((name, index) => names.indexOf(name) !== index));

  const lines = [
    '# language: es',
    `@diagrama-${safeFileName(first.diagramName, 'sin-nombre')}`,
    `Característica: ${activity}`,
    `  Requisitos levantados para la actividad "${activity}" del diagrama "${diagram}".`,
  ];
  rows.forEach((row, index) => {
    const name = names[index]!;
    lines.push(
      '',
      `  ${scenarioTags(row)}`,
      `  Escenario: ${repeated.has(name) ? `${name} #${row.shortId}` : name}`,
      `    Dado ${oneLine(row.given)}`,
      `    Cuando ${oneLine(row.when)}`,
      `    Entonces ${oneLine(row.then)}`,
    );
  });
  return `${lines.join('\n')}\n`;
}

export type FeatureFile = { path: string; content: string };

/**
 * Los archivos del ZIP, `<diagrama>/<actividad>.feature`, a medida que llegan las filas (que
 * vienen ordenadas por diagrama y actividad): solo se retienen las de la actividad en curso.
 */
export async function* featureFiles(rows: AsyncIterable<ExportRow>): AsyncGenerator<FeatureFile> {
  const folderName = uniqueNames();
  const folders = new Map<string, { name: string; fileName: (name: string) => string }>();
  let group: ExportRow[] = [];

  const flush = (): FeatureFile => {
    const [first] = group;
    let folder = folders.get(first!.diagramId);
    if (!folder) {
      folder = { name: folderName(safeFileName(first!.diagramName)), fileName: uniqueNames() };
      folders.set(first!.diagramId, folder);
    }
    const file = folder.fileName(safeFileName(first!.activityLabel ?? ORPHAN_ACTIVITY));
    return { path: `${folder.name}/${file}.feature`, content: renderFeature(group) };
  };

  for await (const row of rows) {
    const [first] = group;
    if (first && (first.diagramId !== row.diagramId || first.activityKey !== row.activityKey)) {
      yield flush();
      group = [];
    }
    group.push(row);
  }
  if (group.length > 0) yield flush();
}

/** El ZIP de la exportación a Gherkin; sin escenarios, lleva un `LEEME.txt` que lo indica. */
export function gherkinZip(rows: AsyncIterable<ExportRow>): Readable {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  (async () => {
    let files = 0;
    for await (const file of featureFiles(rows)) {
      archive.append(file.content, { name: file.path });
      files += 1;
    }
    if (files === 0) archive.append(README, { name: README_NAME });
    await archive.finalize();
  })().catch((error: Error) => archive.destroy(error));
  return archive;
}
