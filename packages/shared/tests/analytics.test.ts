import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_STAGES,
  AnalysisInputFileSchema,
  AnalysisJobInputSchema,
  AnalysisJobReturnSchema,
  AnalysisProgressSchema,
  AnalysisResultsSchema,
  AnalysisRunSchema,
  AnalysisRunStatusSchema,
  DashboardFiltersSchema,
  DescriptiveDashboardSchema,
} from '../src/analytics';

// Contrato de la cola `analysis` (specs/007-dashboard-analitico/contracts/analysis-job.md). Los
// ejemplos son los mismos que valida el lado Python (apps/analytics/tests/contract/examples/analysis).

const example = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          `../../../apps/analytics/tests/contract/examples/analysis/${name}.json`,
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;

const issues = (result: { error?: { issues: unknown[] } }) => result.error?.issues ?? [];

describe('ejemplos del contrato', () => {
  it('la entrada del job valida', () => {
    expect(issues(AnalysisJobInputSchema.safeParse(example('job-input')))).toEqual([]);
    expect(issues(AnalysisJobInputSchema.safeParse(example('job-input-insights')))).toEqual([]);
  });

  it('el archivo de entrada valida', () => {
    expect(issues(AnalysisInputFileSchema.safeParse(example('input-file')))).toEqual([]);
  });

  it.each(['return-done', 'return-partial', 'return-insufficient', 'return-failed'])(
    'el retorno %s valida',
    (name) => {
      expect(issues(AnalysisJobReturnSchema.safeParse(example(name)))).toEqual([]);
    },
  );

  it('los resultados validan', () => {
    expect(issues(AnalysisResultsSchema.safeParse(example('results')))).toEqual([]);
  });

  it('el progreso valida', () => {
    expect(issues(AnalysisProgressSchema.safeParse(example('progress')))).toEqual([]);
  });
});

describe('entrada del job', () => {
  const input = () => example('job-input');

  it('solo la versión 1', () => {
    expect(AnalysisJobInputSchema.safeParse({ ...input(), v: 2 }).success).toBe(false);
  });

  it('rechaza etapas desconocidas o repetidas', () => {
    expect(AnalysisJobInputSchema.safeParse({ ...input(), stages: ['magia'] }).success).toBe(false);
    expect(
      AnalysisJobInputSchema.safeParse({ ...input(), stages: ['keywords', 'keywords'] }).success,
    ).toBe(false);
  });

  it('regenerar insights exige solo esa etapa y los resultados anteriores', () => {
    const regenerate = example('job-input-insights');
    expect(
      AnalysisJobInputSchema.safeParse({ ...regenerate, previousResultsUrl: null }).success,
    ).toBe(false);
    expect(
      AnalysisJobInputSchema.safeParse({ ...regenerate, stages: ['insights', 'quality'] }).success,
    ).toBe(false);
  });

  it('limita los términos del proyecto (100 ambiguos, 200 palabras vacías)', () => {
    const settings = (input() as { settings: Record<string, unknown> }).settings;
    const many = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    expect(
      AnalysisJobInputSchema.safeParse({
        ...input(),
        settings: { ...settings, extraAmbiguousTerms: many(101) },
      }).success,
    ).toBe(false);
    expect(
      AnalysisJobInputSchema.safeParse({
        ...input(),
        settings: { ...settings, extraStopwords: many(201) },
      }).success,
    ).toBe(false);
  });
});

describe('archivo de entrada', () => {
  it('nunca lleva datos del autor', () => {
    const file = example('input-file') as { details: Record<string, unknown>[] };
    const withAuthor = {
      ...file,
      details: [{ ...file.details[0], authorId: '66f0', author: { name: 'Ana' } }],
    };
    const parsed = AnalysisInputFileSchema.parse(withAuthor);
    expect(parsed.details[0]).not.toHaveProperty('authorId');
    expect(parsed.details[0]).not.toHaveProperty('author');
  });

  it('un par de decisiones tiene exactamente dos detalles', () => {
    const file = example('input-file');
    expect(
      AnalysisInputFileSchema.safeParse({
        ...file,
        duplicateDecisions: [{ pair: ['a'], decision: 'rejected' }],
      }).success,
    ).toBe(false);
  });
});

describe('retorno del job', () => {
  it('failed exige un código de error', () => {
    const failed = example('return-failed');
    expect(AnalysisJobReturnSchema.safeParse({ ...failed, error: undefined }).success).toBe(false);
  });

  it('las etapas solo pueden terminar done, failed o skipped', () => {
    const done = example('return-done') as { stages: Record<string, unknown> };
    expect(
      AnalysisJobReturnSchema.safeParse({
        ...done,
        stages: { ...done.stages, keywords: { status: 'completed' } },
      }).success,
    ).toBe(false);
  });
});

describe('resultados', () => {
  it('schemaVersion 1 y secciones opcionales', () => {
    expect(AnalysisResultsSchema.safeParse({ schemaVersion: 1, stages: {} }).success).toBe(true);
    expect(AnalysisResultsSchema.safeParse({ schemaVersion: 2, stages: {} }).success).toBe(false);
  });

  it('un insight necesita al menos una evidencia y como máximo hay 10', () => {
    const results = example('results') as { insights: Record<string, unknown>[] };
    const insight = results.insights[0]!;
    expect(
      AnalysisResultsSchema.safeParse({ ...results, insights: [{ ...insight, evidence: [] }] })
        .success,
    ).toBe(false);
    expect(
      AnalysisResultsSchema.safeParse({
        ...results,
        insights: Array.from({ length: 11 }, (_, i) => ({ ...insight, id: `i${i}` })),
      }).success,
    ).toBe(false);
  });

  it('el puntaje de calidad va de 0 a 100', () => {
    const results = example('results') as { quality: Record<string, unknown>[] };
    expect(
      AnalysisResultsSchema.safeParse({
        ...results,
        quality: [{ ...results.quality[0], score: 120 }],
      }).success,
    ).toBe(false);
  });
});

describe('estados y filtros', () => {
  it('los runs usan los estados de la constitución (VI)', () => {
    expect(AnalysisRunStatusSchema.options).toEqual(['pending', 'running', 'done', 'failed']);
  });

  it('las etapas del análisis', () => {
    expect(ANALYSIS_STAGES).toEqual([
      'keywords',
      'cooccurrence',
      'topics',
      'clusters',
      'duplicates',
      'sentiment',
      'quality',
      'association',
      'hotcold',
      'insights',
    ]);
  });

  it('por defecto se analizan los detalles pendientes y validados', () => {
    expect(DashboardFiltersSchema.parse({})).toEqual({
      diagramIds: null,
      from: null,
      to: null,
      types: null,
      statuses: ['pending', 'validated'],
    });
  });

  it('las fechas son días y el rango no puede invertirse', () => {
    expect(DashboardFiltersSchema.safeParse({ from: '2026-10-01T10:00:00Z' }).success).toBe(false);
    expect(DashboardFiltersSchema.safeParse({ from: '2026-10-05', to: '2026-10-01' }).success).toBe(
      false,
    );
    expect(DashboardFiltersSchema.safeParse({ from: '2026-10-01', to: '2026-10-01' }).success).toBe(
      true,
    );
  });

  it('el run que ve la web', () => {
    const run = {
      id: '6700',
      projectId: '66f0',
      status: 'done',
      partial: true,
      kind: 'full',
      trigger: 'manual',
      progress: null,
      filters: DashboardFiltersSchema.parse({}),
      stages: { topics: { status: 'skipped', reason: 'INSUFFICIENT_DATA' } },
      detailCount: 12,
      stale: false,
      newDetailsSinceRun: 0,
      error: null,
      createdAt: '2026-10-02T10:00:00.000Z',
      finishedAt: '2026-10-02T10:01:00.000Z',
    };
    expect(issues(AnalysisRunSchema.safeParse(run))).toEqual([]);
    expect(AnalysisRunSchema.safeParse({ ...run, status: 'completed' }).success).toBe(false);
  });

  it('el dashboard descriptivo', () => {
    const count = { key: 'functional', label: 'Funcional', count: 3 };
    expect(
      issues(
        DescriptiveDashboardSchema.safeParse({
          kpis: {
            totalDetails: 3,
            activeParticipants: 2,
            coveredActivitiesPct: 50,
            validatedPct: 33.3,
          },
          byActivity: [{ key: 'act', label: 'Validar pago', count: 3 }],
          byType: [count],
          byPriority: [],
          byRole: [],
          byStatus: [],
          timeline: [{ date: '2026-10-01', created: 3, votes: 1, comments: 0 }],
        }),
      ),
    ).toEqual([]);
  });
});
