import { z } from 'zod';
import { DetailStatusSchema, DetailTypeSchema, PrioritySchema } from './details';

/**
 * Dashboard analítico (feature 007). El contrato de la cola `analysis`
 * (specs/007-dashboard-analitico/contracts/analysis-job.md) y el esquema de resultados
 * (analysis-results.schema.json) tienen su espejo pydantic en
 * `apps/analytics/src/analytics/mining/schemas.py`; los dos validan los mismos ejemplos.
 */

export const ANALYSIS_CONTRACT_VERSION = 1;
export const ANALYSIS_RESULTS_VERSION = 1;

export const ANALYSIS_STAGES = [
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
] as const;
export const AnalysisStageSchema = z.enum(ANALYSIS_STAGES);

/** Estados de los trabajos asíncronos (constitución VI); `partial` indica etapas fallidas. */
export const AnalysisRunStatusSchema = z.enum(['pending', 'running', 'done', 'failed']);
export const StageStatusSchema = z.enum(['done', 'failed', 'skipped']);

export const StageResultSchema = z.object({
  status: StageStatusSchema,
  durationMs: z.number().int().min(0).optional(),
  reason: z.string().optional(),
  error: z.string().optional(),
});
const StagesSchema = z.partialRecord(AnalysisStageSchema, StageResultSchema);

const Day = z.iso.date({ error: 'Usa una fecha AAAA-MM-DD.' });

/** Filtros del dashboard (FR-003): los mismos para lo descriptivo y para lanzar un análisis. */
export const DashboardFiltersSchema = z
  .object({
    diagramIds: z.array(z.string().min(1)).min(1).nullable().default(null),
    from: Day.nullable().default(null),
    to: Day.nullable().default(null),
    types: z.array(DetailTypeSchema).min(1).nullable().default(null),
    statuses: z.array(DetailStatusSchema).min(1).default(['pending', 'validated']),
  })
  .refine((filters) => !filters.from || !filters.to || filters.from <= filters.to, {
    error: 'La fecha inicial no puede ser posterior a la final.',
    path: ['to'],
  });

const Term = z.string().trim().min(1).max(60);

export const AnalysisJobSettingsSchema = z.object({
  extraAmbiguousTerms: z.array(Term).max(100),
  extraStopwords: z.array(Term).max(200),
  insightsEnabled: z.boolean(),
  rejectedInsights: z.array(z.string().max(500)).max(50),
});

export const AnalysisJobInputSchema = z
  .object({
    v: z.literal(ANALYSIS_CONTRACT_VERSION),
    runId: z.string().min(1),
    projectId: z.string().min(1),
    kind: z.enum(['full', 'insights']),
    inputUrl: z.url(),
    resultsUrl: z.url(),
    previousResultsUrl: z.url().nullable(),
    stages: z
      .array(AnalysisStageSchema)
      .min(1)
      .refine((stages) => new Set(stages).size === stages.length, {
        error: 'Etapas repetidas',
      }),
    settings: AnalysisJobSettingsSchema,
    requestId: z.string().optional(),
  })
  .refine(
    (input) =>
      input.kind === 'full' ||
      (input.previousResultsUrl !== null &&
        input.stages.length === 1 &&
        input.stages[0] === 'insights'),
    { error: 'Regenerar insights exige solo esa etapa y los resultados anteriores' },
  );

/** Progreso que el worker informa al job (`download` y `upload` rodean a las etapas). */
export const AnalysisProgressSchema = z.object({
  stage: z.union([AnalysisStageSchema, z.enum(['download', 'upload'])]),
  pct: z.number().int().min(0).max(100),
});

/** Detalle exportado al bucket: nunca lleva el autor (solo su rol declarado). */
export const AnalysisInputDetailSchema = z.object({
  id: z.string().min(1),
  diagramId: z.string().min(1),
  activityKey: z.string().min(1),
  given: z.string(),
  when: z.string(),
  then: z.string(),
  type: DetailTypeSchema,
  priority: PrioritySchema.nullable(),
  authorRole: z.string().nullable(),
  tags: z.array(z.string()),
  status: DetailStatusSchema,
  voteCount: z.number().int().min(0),
  commentCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
});

const PairSchema = z.tuple([z.string().min(1), z.string().min(1)]);

export const AnalysisInputFileSchema = z.object({
  v: z.literal(ANALYSIS_CONTRACT_VERSION),
  projectId: z.string().min(1),
  filters: DashboardFiltersSchema,
  activities: z.array(
    z.object({ key: z.string().min(1), diagramId: z.string().min(1), label: z.string() }),
  ),
  details: z.array(AnalysisInputDetailSchema),
  duplicateDecisions: z.array(
    z.object({ pair: PairSchema, decision: z.enum(['confirmed', 'rejected']) }),
  ),
});

export const AnalysisJobReturnSchema = z
  .object({
    v: z.literal(ANALYSIS_CONTRACT_VERSION),
    status: z.enum(['done', 'failed']),
    partial: z.boolean(),
    detailCount: z.number().int().min(0),
    stages: StagesSchema,
    error: z.object({ code: z.string().min(1) }).optional(),
  })
  .refine((value) => value.status === 'done' || value.error !== undefined, {
    error: 'Un análisis fallido indica el código de error',
    path: ['error'],
  });

const WeightedTermSchema = z.object({ term: z.string(), weight: z.number() });

export const InsightSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  statement: z.string().min(1),
  recommendation: z.string().optional(),
  evidence: z
    .array(
      z.object({
        kind: z.enum(['detail', 'activity', 'topic', 'rule', 'quality', 'kpi']),
        id: z.string().min(1),
      }),
    )
    .min(1),
});

export const QualityIssueCodeSchema = z.enum([
  'ambiguous_term',
  'not_measurable',
  'too_short',
  'missing_verb',
  'vague_reference',
]);

/** Espejo de `analysis-results.schema.json` (`schemaVersion: 1`): cada sección es opcional. */
export const AnalysisResultsSchema = z.object({
  schemaVersion: z.literal(ANALYSIS_RESULTS_VERSION),
  stages: StagesSchema,
  preprocess: z.object({ unrecognizedRatio: z.number().min(0).max(1).optional() }).optional(),
  keywords: z
    .object({
      byActivity: z
        .array(z.object({ activityKey: z.string(), terms: z.array(WeightedTermSchema) }))
        .optional(),
      wordCloud: z.array(WeightedTermSchema).optional(),
    })
    .optional(),
  cooccurrence: z
    .object({
      nodes: z
        .array(z.object({ id: z.string(), freq: z.number().int(), community: z.number().int() }))
        .optional(),
      edges: z
        .array(
          z.object({
            source: z.string(),
            target: z.string(),
            pmi: z.number(),
            count: z.number().int(),
          }),
        )
        .optional(),
    })
    .optional(),
  topics: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        terms: z.array(WeightedTermSchema),
        detailIds: z.array(z.string()),
        activityKeys: z.array(z.string()),
      }),
    )
    .optional(),
  clusters: z
    .object({
      groups: z
        .array(
          z.object({
            id: z.string(),
            detailIds: z.array(z.string()),
            representativeId: z.string(),
          }),
        )
        .optional(),
      points: z
        .array(
          z.object({
            detailId: z.string(),
            x: z.number(),
            y: z.number(),
            groupId: z.string().nullable(),
          }),
        )
        .optional(),
    })
    .optional(),
  duplicates: z
    .array(z.object({ pair: PairSchema, similarity: z.number().min(0).max(1) }))
    .optional(),
  sentiment: z
    .object({
      byActivity: z
        .array(
          z.object({
            activityKey: z.string(),
            pos: z.number().int(),
            neu: z.number().int(),
            neg: z.number().int(),
          }),
        )
        .optional(),
      mostNegative: z.array(z.object({ detailId: z.string(), score: z.number() })).optional(),
    })
    .optional(),
  quality: z
    .array(
      z.object({
        detailId: z.string(),
        score: z.number().int().min(0).max(100),
        issues: z.array(
          z.object({
            code: QualityIssueCodeSchema,
            field: z.enum(['given', 'when', 'then']).optional(),
            term: z.string().optional(),
            penalty: z.number().int().optional(),
            suggestion: z.string().optional(),
          }),
        ),
      }),
    )
    .optional(),
  association: z
    .array(
      z.object({
        antecedent: z.array(z.string()),
        consequent: z.array(z.string()),
        support: z.number(),
        confidence: z.number(),
        lift: z.number(),
        sentence: z.string(),
      }),
    )
    .optional(),
  hotcold: z
    .array(
      z.object({
        activityKey: z.string(),
        class: z.enum(['hot', 'cold', 'normal']),
        score: z.number(),
        reason: z.string(),
      }),
    )
    .optional(),
  insightsFewerThanExpected: z.boolean().optional(),
  insights: z.array(InsightSchema).max(10).optional(),
});

/** Run tal como lo ve la web (`GET /analysis-runs/:id`, `…/latest` con `results`). */
export const AnalysisRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: AnalysisRunStatusSchema,
  partial: z.boolean(),
  kind: z.enum(['full', 'insights']),
  trigger: z.enum(['manual', 'scheduled']),
  progress: AnalysisProgressSchema.nullable(),
  filters: DashboardFiltersSchema,
  stages: StagesSchema,
  detailCount: z.number().int().min(0).nullable(),
  stale: z.boolean(),
  newDetailsSinceRun: z.number().int().min(0),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  results: AnalysisResultsSchema.optional(),
  /**
   * Conjunto analizado (junto a `results`): las actividades y los detalles tal como estaban al
   * lanzar el análisis, para mostrar sus textos sin más consultas. Nunca lleva el autor.
   */
  input: z
    .object({
      activities: AnalysisInputFileSchema.shape.activities,
      details: z.array(AnalysisInputDetailSchema),
    })
    .optional(),
});

/** Decisión del Administrador sobre un par de posibles duplicados (US3, FR-007). */
export const DuplicateDecisionInputSchema = z
  .object({
    pair: PairSchema.refine(([a, b]) => a !== b, {
      error: 'El par necesita dos detalles distintos.',
    }),
    decision: z.enum(['confirmed', 'rejected']),
    /** Al confirmar: el detalle que se conserva; el otro queda como duplicado suyo. */
    keep: z.string().min(1).optional(),
    similarity: z.number().min(0).max(1).optional(),
  })
  .refine((input) => input.decision === 'rejected' || input.keep !== undefined, {
    error: 'Indica cuál de los dos detalles se conserva.',
    path: ['keep'],
  })
  .refine((input) => input.keep === undefined || input.pair.includes(input.keep), {
    error: 'El detalle que se conserva debe ser uno de los dos del par.',
    path: ['keep'],
  });

export const DuplicateDecisionSchema = z.object({
  id: z.string(),
  pair: PairSchema,
  decision: z.enum(['confirmed', 'rejected']),
  decidedAt: z.iso.datetime(),
});

const TermList = (max: number, what: string) =>
  z
    .array(Term)
    .max(max, { error: `Como máximo ${max} ${what}.` })
    .transform((terms) => [...new Set(terms.map((term) => term.toLowerCase()))]);

/** Ajustes del análisis de un proyecto tal como se devuelven (FR-009, FR-013). */
export const AnalysisSettingsSchema = z.object({
  extraAmbiguousTerms: z.array(z.string()),
  extraStopwords: z.array(z.string()),
  schedule: z.object({ enabled: z.boolean(), cron: z.string(), timezone: z.string() }),
});

/** Ajustes al guardarlos: términos en minúsculas y sin repetir, cron y zona horaria válidos. */
export const AnalysisSettingsInputSchema = z.object({
  extraAmbiguousTerms: TermList(100, 'términos ambiguos'),
  extraStopwords: TermList(200, 'palabras vacías'),
  schedule: z.object({
    enabled: z.boolean(),
    /** Cron de cinco campos (minuto hora día mes día-de-la-semana). */
    cron: z
      .string()
      .trim()
      .regex(/^(\S+\s+){4}\S+$/, {
        error: 'Usa un cron de cinco campos, por ejemplo «0 3 * * *».',
      }),
    timezone: z.string().refine(
      (zone) => {
        try {
          new Intl.DateTimeFormat('es', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      },
      { error: 'Zona horaria desconocida.' },
    ),
  }),
});

const CountSchema = z.object({ key: z.string(), label: z.string(), count: z.number().int() });

/** Capa descriptiva (US1, FR-002), calculada al momento en `api`. */
export const DescriptiveDashboardSchema = z.object({
  kpis: z.object({
    totalDetails: z.number().int().min(0),
    activeParticipants: z.number().int().min(0),
    coveredActivitiesPct: z.number().min(0).max(100),
    validatedPct: z.number().min(0).max(100),
  }),
  byActivity: z.array(CountSchema),
  byType: z.array(CountSchema),
  byPriority: z.array(CountSchema),
  byRole: z.array(CountSchema),
  byStatus: z.array(CountSchema),
  timeline: z.array(
    z.object({
      date: Day,
      created: z.number().int().min(0),
      votes: z.number().int().min(0),
      comments: z.number().int().min(0),
    }),
  ),
});

export type AnalysisStage = z.infer<typeof AnalysisStageSchema>;
export type AnalysisRunStatus = z.infer<typeof AnalysisRunStatusSchema>;
export type StageResult = z.infer<typeof StageResultSchema>;
export type DashboardFilters = z.infer<typeof DashboardFiltersSchema>;
export type DashboardFiltersInput = z.input<typeof DashboardFiltersSchema>;
export type AnalysisJobSettings = z.infer<typeof AnalysisJobSettingsSchema>;
export type AnalysisJobInput = z.infer<typeof AnalysisJobInputSchema>;
export type AnalysisProgress = z.infer<typeof AnalysisProgressSchema>;
export type AnalysisInputDetail = z.infer<typeof AnalysisInputDetailSchema>;
export type AnalysisInputFile = z.infer<typeof AnalysisInputFileSchema>;
export type AnalysisJobReturn = z.infer<typeof AnalysisJobReturnSchema>;
export type Insight = z.infer<typeof InsightSchema>;
export type AnalysisResults = z.infer<typeof AnalysisResultsSchema>;
export type AnalysisRun = z.infer<typeof AnalysisRunSchema>;
export type DescriptiveDashboard = z.infer<typeof DescriptiveDashboardSchema>;
export type DuplicateDecisionInput = z.infer<typeof DuplicateDecisionInputSchema>;
export type DuplicateDecision = z.infer<typeof DuplicateDecisionSchema>;
export type AnalysisSettings = z.infer<typeof AnalysisSettingsSchema>;
export type AnalysisSettingsInput = z.input<typeof AnalysisSettingsInputSchema>;
