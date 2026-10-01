import { z } from 'zod';

/** Tipo de requisito (FR-002). */
export const DetailTypeSchema = z.enum([
  'functional',
  'non_functional',
  'business_rule',
  'constraint',
]);

/** Prioridad MoSCoW (FR-003). */
export const PrioritySchema = z.enum(['must', 'should', 'could', 'wont']);

/** Estado de moderación (FR-010); `pending` al crearse. */
export const DetailStatusSchema = z.enum(['pending', 'validated', 'duplicate', 'discarded']);

/** Un componente del escenario: obligatorio, de 5 a 1 000 caracteres, texto plano. */
const scenarioPart = (name: string) => {
  const capitalized = name[0]!.toUpperCase() + name.slice(1);
  return z
    .string({ error: `Escribe ${name}.` })
    .trim()
    .min(5, { error: `Escribe ${name}: al menos 5 caracteres.` })
    .max(1000, { error: `${capitalized} admite como máximo 1 000 caracteres.` });
};

/** Etiqueta normalizada: minúsculas y espacios simples (para agrupar y sugerir). */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').toLowerCase();
}

const TagsSchema = z
  .array(
    z
      .string()
      .transform(normalizeTag)
      .pipe(
        z
          .string()
          .min(1, { error: 'Una etiqueta no puede estar vacía.' })
          .max(30, { error: 'Cada etiqueta admite como máximo 30 caracteres.' }),
      ),
  )
  .transform((tags) => [...new Set(tags)])
  .pipe(z.array(z.string()).max(10, { error: 'Como máximo 10 etiquetas.' }));

const AuthorRoleSchema = z
  .string()
  .trim()
  .max(60, { error: 'El rol admite como máximo 60 caracteres.' })
  .nullable()
  .transform((role) => role || null);

const detailFields = {
  given: scenarioPart('el contexto (Dado)'),
  when: scenarioPart('la acción (Cuando)'),
  then: scenarioPart('el resultado (Entonces)'),
  type: DetailTypeSchema,
  priority: PrioritySchema.nullable(),
  authorRole: AuthorRoleSchema,
  tags: TagsSchema,
};

/** Cuerpo de POST …/activities/:key/details. */
export const DetailInputSchema = z.object({
  ...detailFields,
  priority: detailFields.priority.default(null),
  authorRole: detailFields.authorRole.default(null),
  tags: detailFields.tags.default([]),
});

/** Cuerpo de PATCH /details/:id (con `If-Match`): al menos un campo. */
export const DetailPatchSchema = z
  .object(detailFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { error: 'No hay cambios que guardar.' });

/** Cuerpo de POST /details/:id/status (solo Administrador). */
export const StatusChangeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('validated') }),
  z.object({
    status: z.literal('duplicate'),
    duplicateOf: z.string({ error: 'Indica de qué detalle es duplicado.' }).min(1),
  }),
  z.object({
    status: z.literal('discarded'),
    discardReason: z
      .string({ error: 'Indica el motivo del descarte.' })
      .trim()
      .min(1, { error: 'Indica el motivo del descarte.' })
      .max(500, { error: 'El motivo admite como máximo 500 caracteres.' }),
  }),
]);

/** Cuerpo de POST /details/:id/reassign (solo Administrador). */
export const ReassignInputSchema = z.object({
  diagramId: z.string().min(1),
  activityKey: z.uuid(),
});

export const UserRefSchema = z.object({ id: z.string(), name: z.string() });

export const DetailPermissionsSchema = z.object({
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  canVote: z.boolean(),
  canModerate: z.boolean(),
});

export const DetailSchema = z.object({
  id: z.string(),
  diagramId: z.string(),
  activityKey: z.string(),
  given: z.string(),
  when: z.string(),
  then: z.string(),
  type: DetailTypeSchema,
  priority: PrioritySchema.nullable(),
  authorRole: z.string().nullable(),
  tags: z.array(z.string()),
  status: DetailStatusSchema,
  duplicateOf: z.string().nullable(),
  discardReason: z.string().nullable(),
  voteCount: z.number().int().min(0),
  votedByMe: z.boolean(),
  commentCount: z.number().int().min(0),
  author: UserRefSchema,
  rev: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Calculados en el servidor para el usuario actual (research R5). */
  permissions: DetailPermissionsSchema,
});

export const HistoryEntrySchema = z.object({
  rev: z.number().int().min(0),
  change: z.enum(['edit', 'status', 'reassign']),
  editedBy: UserRefSchema,
  editedAt: z.iso.datetime(),
  snapshot: z.record(z.string(), z.unknown()),
});

export const VoteStateSchema = z.object({
  voteCount: z.number().int().min(0),
  votedByMe: z.boolean(),
});

export const CommentInputSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, { error: 'Escribe el comentario.' })
    .max(1000, { error: 'El comentario admite como máximo 1 000 caracteres.' }),
});

export const CommentSchema = z.object({
  id: z.string(),
  detailId: z.string(),
  text: z.string(),
  author: UserRefSchema,
  createdAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable(),
  /** Calculados en el servidor para el usuario actual. */
  permissions: z.object({ canEdit: z.boolean(), canDelete: z.boolean() }),
});

/** Cobertura de una actividad para los indicadores del canvas (research R7). */
export const ActivityCoverageSchema = z.object({
  activityKey: z.string(),
  /** Detalles que cuentan: sin `discarded` ni `duplicate`. */
  total: z.number().int().min(0),
  byStatus: z.record(DetailStatusSchema, z.number().int().min(0)),
  /** Votos propios más los de sus duplicados (research R6). */
  effectiveVotes: z.number().int().min(0),
  top: z.array(z.object({ id: z.string(), summary: z.string().max(80) })).max(3),
});

export const FacetSchema = z.object({ value: z.string(), count: z.number().int().min(1) });
export const FacetsSchema = z.object({ roles: z.array(FacetSchema), tags: z.array(FacetSchema) });

const SUMMARY_LENGTH = 80;

/** Resumen de un detalle para las notas del canvas: «Cuando … → Entonces …» (research R8). */
export function detailSummary({ when, then }: { when: string; then: string }): string {
  const text = `Cuando ${when} → Entonces ${then}`;
  return text.length <= SUMMARY_LENGTH ? text : `${text.slice(0, SUMMARY_LENGTH - 1)}…`;
}

export type DetailType = z.infer<typeof DetailTypeSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type DetailStatus = z.infer<typeof DetailStatusSchema>;
export type DetailInput = z.input<typeof DetailInputSchema>;
export type DetailFields = z.output<typeof DetailInputSchema>;
export type DetailPatch = z.output<typeof DetailPatchSchema>;
export type StatusChange = z.infer<typeof StatusChangeSchema>;
export type ReassignInput = z.infer<typeof ReassignInputSchema>;
export type UserRef = z.infer<typeof UserRefSchema>;
export type DetailPermissions = z.infer<typeof DetailPermissionsSchema>;
export type Detail = z.infer<typeof DetailSchema>;
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
export type VoteState = z.infer<typeof VoteStateSchema>;
export type CommentInput = z.infer<typeof CommentInputSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type ActivityCoverage = z.infer<typeof ActivityCoverageSchema>;
export type Facet = z.infer<typeof FacetSchema>;
export type Facets = z.infer<typeof FacetsSchema>;
