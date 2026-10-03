import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ExportInputFileSchema,
  ExportJobInputSchema,
  ExportJobReturnSchema,
  ExportRequestSchema,
  ExportSchema,
  ExportStatusSchema,
} from '../src/exports';

// Contrato de la cola `export` (specs/008-exportacion-resultados/contracts/export-job.md). Los
// ejemplos son los mismos que valida el lado Python (apps/analytics/tests/contract/examples/export).

const example = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          `../../../apps/analytics/tests/contract/examples/export/${name}.json`,
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;

const issues = (result: { error?: { issues: unknown[] } }) => result.error?.issues ?? [];

describe('ejemplos del contrato', () => {
  it('la entrada del job valida', () => {
    expect(issues(ExportJobInputSchema.safeParse(example('job-input')))).toEqual([]);
  });

  it.each(['input-file', 'input-file-no-analysis'])('el archivo de entrada %s valida', (name) => {
    expect(issues(ExportInputFileSchema.safeParse(example(name)))).toEqual([]);
  });

  it.each(['return-done', 'return-failed'])('el retorno %s valida', (name) => {
    expect(issues(ExportJobReturnSchema.safeParse(example(name)))).toEqual([]);
  });
});

describe('solicitud', () => {
  it('solo los cuatro formatos, con sus valores por defecto', () => {
    for (const format of ['csv', 'xlsx', 'gherkin', 'pdf']) {
      expect(ExportRequestSchema.safeParse({ format }).success).toBe(true);
    }
    expect(ExportRequestSchema.safeParse({ format: 'docx' }).success).toBe(false);
    expect(ExportRequestSchema.safeParse({}).success).toBe(false);
    expect(ExportRequestSchema.parse({ format: 'csv', options: {} }).options).toEqual({
      delimiter: 'comma',
      includePending: false,
    });
  });

  it('los filtros son los del dashboard (007)', () => {
    const parsed = ExportRequestSchema.parse({ format: 'xlsx', filters: {} });
    expect(parsed.filters).toEqual({
      diagramIds: null,
      from: null,
      to: null,
      types: null,
      statuses: ['pending', 'validated'],
    });
    expect(
      ExportRequestSchema.safeParse({
        format: 'csv',
        filters: { from: '2026-10-05', to: '2026-10-01' },
      }).success,
    ).toBe(false);
    expect(
      ExportRequestSchema.safeParse({ format: 'csv', options: { delimiter: 'tab' } }).success,
    ).toBe(false);
  });
});

describe('exportación', () => {
  it('usa los estados de la constitución (VI); la caducidad no es un estado', () => {
    expect(ExportStatusSchema.options).toEqual(['pending', 'running', 'done', 'failed']);
  });

  it('la exportación que ve la web', () => {
    const exported = {
      id: '6710',
      projectId: '66f0',
      format: 'pdf',
      mode: 'async',
      status: 'done',
      expired: false,
      detailCount: 80,
      fileName: 'reqcanvas-tienda-demo-20261003-1000.pdf',
      bytes: 482133,
      error: null,
      createdAt: '2026-10-03T15:00:00.000Z',
      finishedAt: '2026-10-03T15:00:20.000Z',
      expiresAt: '2026-10-04T15:00:20.000Z',
    };
    expect(issues(ExportSchema.safeParse(exported))).toEqual([]);
    expect(ExportSchema.safeParse({ ...exported, status: 'ready' }).success).toBe(false);
    expect(ExportSchema.safeParse({ ...exported, expired: undefined }).success).toBe(false);
  });
});

describe('cola export', () => {
  it('solo la versión 1 y con las dos URLs', () => {
    const input = example('job-input');
    expect(ExportJobInputSchema.safeParse({ ...input, v: 2 }).success).toBe(false);
    expect(ExportJobInputSchema.safeParse({ ...input, outputUrl: undefined }).success).toBe(false);
  });

  it('el archivo de entrada nunca lleva datos de personas', () => {
    const file = example('input-file') as { details: Record<string, unknown>[] };
    const parsed = ExportInputFileSchema.parse({
      ...file,
      details: [{ ...file.details[0], authorId: '66f0', authorName: 'Ana' }],
    });
    expect(parsed.details[0]).not.toHaveProperty('authorId');
    expect(parsed.details[0]).not.toHaveProperty('authorName');
    expect(ExportInputFileSchema.safeParse({ ...file, schemaVersion: 2 }).success).toBe(false);
  });

  it('done exige bytes y páginas; failed, un código de error', () => {
    const done = example('return-done');
    expect(ExportJobReturnSchema.safeParse({ ...done, pages: undefined }).success).toBe(false);
    expect(ExportJobReturnSchema.safeParse({ ...done, bytes: 0 }).success).toBe(false);
    const failed = example('return-failed');
    expect(ExportJobReturnSchema.safeParse({ ...failed, error: undefined }).success).toBe(false);
    expect(ExportJobReturnSchema.safeParse({ ...failed, error: { message: 'x' } }).success).toBe(
      false,
    );
  });
});
