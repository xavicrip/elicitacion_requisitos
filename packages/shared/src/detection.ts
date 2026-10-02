import { z } from 'zod';
import { ActivityInputSchema, ActivityTypeSchema, BBoxSchema } from './diagrams';

/**
 * Detección asistida de actividades (feature 006). El contrato de la cola `detection`
 * (specs/006-deteccion-asistida/contracts/detection-job.md) tiene su espejo pydantic en
 * `apps/analytics/src/analytics/detection/schemas.py`; los dos validan los mismos ejemplos.
 */

export const DETECTION_CONTRACT_VERSION = 1;

export const DETECTION_STAGES = ['download', 'shapes', 'ocr', 'arrows', 'refine'] as const;
export const DetectionStageSchema = z.enum(DETECTION_STAGES);

/** Estados de los trabajos asíncronos (constitución VI). */
export const DetectionJobStatusSchema = z.enum(['pending', 'running', 'done', 'failed']);
export const ProposalStatusSchema = z.enum(['pending', 'accepted', 'discarded', 'superseded']);
export const ConfidenceLevelSchema = z.enum(['high', 'medium', 'low']);
export const ProposalFlagSchema = z.enum([
  'possible_duplicate',
  'llm_added',
  'llm_corrected',
  'empty_label',
]);

/** Nivel de confianza mostrado al Administrador (research R3): alta ≥ 0,8, media ≥ 0,5. */
export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

const Confidence = z.number().min(0).max(1);

export const DetectionOptionsSchema = z.object({
  llmRefine: z.boolean(),
  arrows: z.boolean(),
  languages: z.array(z.string().min(1)).min(1),
});

/** `job.data` de la cola `detection`. */
export const DetectionJobInputSchema = z.object({
  v: z.literal(DETECTION_CONTRACT_VERSION),
  jobId: z.string().min(1),
  versionId: z.string().min(1),
  image: z.object({
    /** URL firmada de la imagen display (10 min). */
    url: z.url(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  options: DetectionOptionsSchema,
  requestId: z.string().min(1),
});

/** `job.updateProgress(...)`. */
export const DetectionProgressSchema = z.object({
  stage: DetectionStageSchema,
  pct: z.number().int().min(0).max(100),
});

export const DetectedActivitySchema = z.object({
  tempId: z.string().min(1),
  bbox: BBoxSchema,
  type: ActivityTypeSchema,
  /** Texto leído tal cual (puede estar vacío). */
  label: z.string().max(300),
  confidence: Confidence,
  flags: z.array(ProposalFlagSchema),
});

export const DetectedTransitionSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  confidence: Confidence,
});

/** Valor de retorno del job. */
export const DetectionResultSchema = z
  .object({
    v: z.literal(DETECTION_CONTRACT_VERSION),
    activities: z.array(DetectedActivitySchema).max(500),
    transitions: z.array(DetectedTransitionSchema).max(2000),
    stats: z.object({
      durationMs: z.number().int().min(0),
      llmUsed: z.boolean(),
      ocrMeanConfidence: Confidence.nullable(),
    }),
  })
  .superRefine((result, ctx) => {
    const ids = new Set<string>();
    for (const activity of result.activities) {
      if (ids.has(activity.tempId)) {
        ctx.addIssue({ code: 'custom', message: `tempId repetido: ${activity.tempId}` });
      }
      ids.add(activity.tempId);
    }
    for (const transition of result.transitions) {
      if (!ids.has(transition.from) || !ids.has(transition.to)) {
        ctx.addIssue({ code: 'custom', message: 'Transición entre zonas inexistentes' });
      } else if (transition.from === transition.to) {
        ctx.addIssue({ code: 'custom', message: 'Transición de una zona a sí misma' });
      }
    }
  });

// REST (contracts/detection.openapi.yaml).

export const DetectionMetricsSchema = z.object({
  proposed: z.number().int().min(0),
  accepted: z.number().int().min(0),
  edited: z.number().int().min(0),
  discarded: z.number().int().min(0),
  durationMs: z.number().int().min(0).nullable(),
  llmUsed: z.boolean(),
});

export const DetectionJobSchema = z.object({
  id: z.string(),
  versionId: z.string(),
  status: DetectionJobStatusSchema,
  progress: DetectionProgressSchema,
  /** Mensaje en español para el Administrador; sin detalles internos (constitución VI). */
  error: z.object({ code: z.string(), message: z.string() }).nullable().optional(),
  metrics: DetectionMetricsSchema,
  createdAt: z.string(),
  finishedAt: z.string().nullable().optional(),
});

/** Cuerpo de POST /diagram-versions/:id/detections. */
export const DetectionStartInputSchema = z.object({
  llmRefine: z.boolean().default(true),
  arrows: z.boolean().default(true),
});

export const ActivityProposalSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  versionId: z.string(),
  bbox: BBoxSchema,
  type: ActivityTypeSchema,
  label: z.string(),
  confidence: Confidence,
  confidenceLevel: ConfidenceLevelSchema,
  flags: z.array(ProposalFlagSchema),
  status: ProposalStatusSchema,
  activityId: z.string().nullable().optional(),
});

export const TransitionProposalSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  versionId: z.string(),
  fromProposalId: z.string(),
  toProposalId: z.string(),
  confidence: Confidence,
  status: ProposalStatusSchema,
});

export const ProposalsSchema = z.object({
  activities: z.array(ActivityProposalSchema),
  transitions: z.array(TransitionProposalSchema),
});

/** Cuerpo de POST /proposals/:id/accept: correcciones opcionales (las mismas reglas que la 003). */
export const ProposalAcceptInputSchema = ActivityInputSchema.pick({
  label: true,
  type: true,
  bbox: true,
}).partial();

export type DetectionStage = z.infer<typeof DetectionStageSchema>;
export type DetectionJobStatus = z.infer<typeof DetectionJobStatusSchema>;
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;
export type ProposalFlag = z.infer<typeof ProposalFlagSchema>;
export type DetectionOptions = z.infer<typeof DetectionOptionsSchema>;
export type DetectionJobInput = z.infer<typeof DetectionJobInputSchema>;
export type DetectionProgress = z.infer<typeof DetectionProgressSchema>;
export type DetectedActivity = z.infer<typeof DetectedActivitySchema>;
export type DetectedTransition = z.infer<typeof DetectedTransitionSchema>;
export type DetectionResult = z.infer<typeof DetectionResultSchema>;
export type DetectionMetrics = z.infer<typeof DetectionMetricsSchema>;
export type DetectionJob = z.infer<typeof DetectionJobSchema>;
export type DetectionStartInput = z.input<typeof DetectionStartInputSchema>;
export type ActivityProposal = z.infer<typeof ActivityProposalSchema>;
export type TransitionProposal = z.infer<typeof TransitionProposalSchema>;
export type Proposals = z.infer<typeof ProposalsSchema>;
export type ProposalAcceptInput = z.infer<typeof ProposalAcceptInputSchema>;

/** Eventos de dominio de la detección (plan, ajuste 7), retransmitidos a `diagram:{versionId}`. */
type DetectionBase = {
  projectId: string;
  diagramId: string;
  versionId: string;
  jobId: string;
  at: string;
};

export type DetectionEvents = {
  'detection.progress': DetectionBase & DetectionProgress;
  'detection.completed': DetectionBase & { proposed: number };
  'detection.failed': DetectionBase & { error: { code: string; message: string } };
  'proposal.reviewed': DetectionBase & {
    proposalId: string;
    kind: 'activity' | 'transition';
    status: ProposalStatus;
    activityId?: string;
    actorId: string;
  };
};

export type DetectionEventName = keyof DetectionEvents;

export const DETECTION_EVENTS = [
  'detection.progress',
  'detection.completed',
  'detection.failed',
  'proposal.reviewed',
] as const satisfies readonly DetectionEventName[];

// Esquemas de los eventos tal como llegan por el socket (prueba de contrato, constitución III).
const Id = z.string().min(1);
const DetectionEnvelope = {
  eventId: z.uuid(),
  projectId: Id,
  diagramId: Id,
  versionId: Id,
  jobId: Id,
  at: z.iso.datetime(),
};

export const DETECTION_EVENT_SCHEMAS = {
  'detection.progress': z
    .object({ ...DetectionEnvelope, ...DetectionProgressSchema.shape })
    .strict(),
  'detection.completed': z
    .object({ ...DetectionEnvelope, proposed: z.number().int().min(0) })
    .strict(),
  'detection.failed': z
    .object({ ...DetectionEnvelope, error: z.object({ code: Id, message: Id }).strict() })
    .strict(),
  'proposal.reviewed': z
    .object({
      ...DetectionEnvelope,
      proposalId: Id,
      kind: z.enum(['activity', 'transition']),
      status: ProposalStatusSchema,
      activityId: Id.optional(),
      actorId: Id,
    })
    .strict(),
} satisfies Record<DetectionEventName, z.ZodType>;
