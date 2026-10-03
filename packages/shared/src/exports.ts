import { z } from 'zod';
import {
  AnalysisResultsSchema,
  AnalysisStageSchema,
  DashboardFiltersSchema,
  DescriptiveDashboardSchema,
  StageResultSchema,
} from './analytics';
import { DetailStatusSchema, DetailTypeSchema, PrioritySchema } from './details';
import { BBoxSchema } from './diagrams';

/**
 * Exportación de requisitos y reportes (feature 008). El contrato de la cola `export`
 * (specs/008-exportacion-resultados/contracts/export-job.md) tiene su espejo pydantic en
 * `apps/analytics/src/analytics/reports/schemas.py`; los dos validan los mismos ejemplos.
 */

export const EXPORT_CONTRACT_VERSION = 1;
export const EXPORT_INPUT_VERSION = 1;

export const ExportFormatSchema = z.enum(['csv', 'xlsx', 'gherkin', 'pdf'], {
  error: 'Formato de exportación no válido.',
});
/** Estados de los trabajos asíncronos (constitución VI). La caducidad no es un estado. */
export const ExportStatusSchema = z.enum(['pending', 'running', 'done', 'failed']);
export const ExportModeSchema = z.enum(['sync', 'async']);

export const ExportOptionsSchema = z.object({
  /** Delimitador del CSV: `;` para hojas de cálculo con coma decimal. */
  delimiter: z.enum(['comma', 'semicolon']).default('comma'),
  /** Solo Gherkin: incluir también los detalles pendientes. */
  includePending: z.boolean().default(false),
});

export const ExportRequestSchema = z.object({
  format: ExportFormatSchema,
  filters: DashboardFiltersSchema.optional(),
  options: ExportOptionsSchema.optional(),
});

const ErrorSchema = z.object({ code: z.string().min(1), message: z.string() });

/** La exportación que ve la web (historial y estado). */
export const ExportSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  format: ExportFormatSchema,
  mode: ExportModeSchema,
  status: ExportStatusSchema,
  /** Han pasado más de 24 h desde que terminó: ya no se puede descargar. */
  expired: z.boolean(),
  detailCount: z.number().int().min(0),
  fileName: z.string().nullable(),
  bytes: z.number().int().min(0).nullable(),
  error: ErrorSchema.nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
});

// --- Cola `export` (reporte PDF) -------------------------------------------------------------

export const ExportJobInputSchema = z.object({
  v: z.literal(EXPORT_CONTRACT_VERSION),
  exportId: z.string().min(1),
  projectId: z.string().min(1),
  /** URL firmada (GET) del archivo de entrada, `input.json.gz`. */
  inputUrl: z.url(),
  /** URL firmada (PUT) donde el worker sube el PDF. */
  outputUrl: z.url(),
  requestId: z.string().min(1),
});

/** Un detalle del reporte: sin nombres ni identificadores de personas (sí el rol declarado). */
export const ExportInputDetailSchema = z.object({
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

export const ExportInputDiagramSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** Imagen del diagrama publicado, con una URL firmada de lectura. */
  image: z.object({
    url: z.url(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  activities: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string(),
      bbox: BBoxSchema,
      detailCount: z.number().int().min(0),
    }),
  ),
});

export const ExportInputAnalysisSchema = z.object({
  finishedAt: z.iso.datetime(),
  stages: z.partialRecord(AnalysisStageSchema, StageResultSchema),
  results: AnalysisResultsSchema,
});

export const ExportInputFileSchema = z.object({
  schemaVersion: z.literal(EXPORT_INPUT_VERSION),
  project: z.object({ name: z.string(), timezone: z.string().min(1) }),
  generatedAt: z.iso.datetime(),
  filters: DashboardFiltersSchema,
  /** Los mismos indicadores que muestra el dashboard con esos filtros (SC-004). */
  descriptive: DescriptiveDashboardSchema,
  diagrams: z.array(ExportInputDiagramSchema),
  details: z.array(ExportInputDetailSchema),
  /** El último análisis terminado, o `null` si no hay ninguno. */
  analysis: ExportInputAnalysisSchema.nullable(),
});

export const ExportJobReturnSchema = z.discriminatedUnion('status', [
  z.object({
    v: z.literal(EXPORT_CONTRACT_VERSION),
    status: z.literal('done'),
    bytes: z.number().int().positive(),
    pages: z.number().int().positive(),
  }),
  z.object({
    v: z.literal(EXPORT_CONTRACT_VERSION),
    status: z.literal('failed'),
    error: ErrorSchema,
  }),
]);

export type ExportFormat = z.infer<typeof ExportFormatSchema>;
export type ExportStatus = z.infer<typeof ExportStatusSchema>;
export type ExportMode = z.infer<typeof ExportModeSchema>;
export type ExportOptions = z.infer<typeof ExportOptionsSchema>;
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export type ExportRequestInput = z.input<typeof ExportRequestSchema>;
export type Export = z.infer<typeof ExportSchema>;
export type ExportJobInput = z.infer<typeof ExportJobInputSchema>;
export type ExportInputDetail = z.infer<typeof ExportInputDetailSchema>;
export type ExportInputDiagram = z.infer<typeof ExportInputDiagramSchema>;
export type ExportInputFile = z.infer<typeof ExportInputFileSchema>;
export type ExportJobReturn = z.infer<typeof ExportJobReturnSchema>;
