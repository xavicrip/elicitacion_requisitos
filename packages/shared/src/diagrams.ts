import { z } from 'zod';

/** Tipo de una actividad (FR-004). */
export const ActivityTypeSchema = z.enum(['action', 'decision', 'start', 'end']);

/** Estado de una versión de diagrama (data-model: máx. 1 publicada y 1 en borrador). */
export const VersionStatusSchema = z.enum(['draft', 'published', 'archived']);

/** Margen para el redondeo de coma flotante al comprobar que la caja no sale de la imagen. */
const EPSILON = 1e-9;

/**
 * Caja de una actividad en coordenadas **normalizadas** (0–1) respecto a la imagen display
 * (research R6): no depende de la resolución y sobrevive a una imagen nueva del mismo tamaño
 * relativo.
 */
export const BBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().gt(0).max(1),
    h: z.number().gt(0).max(1),
  })
  .refine((box) => box.x + box.w <= 1 + EPSILON && box.y + box.h <= 1 + EPSILON, {
    error: 'La zona debe quedar dentro de la imagen.',
  });

const LabelSchema = z
  .string()
  .trim()
  .min(1, { error: 'Escribe el nombre de la actividad.' })
  .max(120, { error: 'El nombre admite como máximo 120 caracteres.' });

/** `key` de las actividades destino (transiciones, FR-005), sin duplicados. */
const NextSchema = z.array(z.string().min(1)).refine((keys) => new Set(keys).size === keys.length, {
  error: 'Una actividad no puede enlazar dos veces con la misma.',
});

/** Cuerpo de POST /diagram-versions/:id/activities. */
export const ActivityInputSchema = z.object({
  label: LabelSchema,
  type: ActivityTypeSchema,
  bbox: BBoxSchema,
  next: NextSchema.optional(),
});

/** Cuerpo de PATCH /activities/:id (con `If-Match`): al menos un campo. */
export const ActivityPatchSchema = z
  .object({
    label: LabelSchema.optional(),
    type: ActivityTypeSchema.optional(),
    bbox: BBoxSchema.optional(),
    next: NextSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { error: 'No hay cambios que guardar.' });

export const ActivitySchema = z.object({
  id: z.string(),
  /** Estable entre versiones del diagrama: es el ancla de los requisitos (Principio I, 004). */
  key: z.uuid(),
  rev: z.number().int().min(0),
  source: z.enum(['manual', 'detected']),
  label: z.string(),
  type: ActivityTypeSchema,
  bbox: BBoxSchema,
  next: z.array(z.string()),
});

/** Campo `name` del formulario de subida (multipart). */
export const DiagramInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Escribe el nombre del diagrama.' })
    .max(100, { error: 'El nombre admite como máximo 100 caracteres.' }),
});

export const DiagramSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int().min(0),
  publishedVersionId: z.string().nullable().optional(),
  /** Solo para el Administrador. */
  draftVersionId: z.string().nullable().optional(),
  /** Ruta relativa servida por `api` (plan, ajuste 1). */
  thumbUrl: z.string().optional(),
});

export const DiagramVersionSchema = z.object({
  id: z.string(),
  diagramId: z.string(),
  number: z.number().int().min(1),
  status: VersionStatusSchema,
  image: z.object({
    /** `/api/diagram-versions/{id}/image/display` (mismo origen, plan ajuste 1). */
    displayUrl: z.string(),
    thumbUrl: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  publishedAt: z.iso.datetime().nullable().optional(),
});

/** GET /diagram-versions/:id: la versión con sus actividades. */
export const VersionWithActivitiesSchema = DiagramVersionSchema.extend({
  activities: z.array(ActivitySchema),
});

export type ActivityType = z.infer<typeof ActivityTypeSchema>;
export type VersionStatus = z.infer<typeof VersionStatusSchema>;
export type BBox = z.infer<typeof BBoxSchema>;
export type ActivityInput = z.infer<typeof ActivityInputSchema>;
export type ActivityPatch = z.infer<typeof ActivityPatchSchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type DiagramSummary = z.infer<typeof DiagramSummarySchema>;
export type DiagramVersion = z.infer<typeof DiagramVersionSchema>;
export type VersionWithActivities = z.infer<typeof VersionWithActivitiesSchema>;
