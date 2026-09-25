# Data Model: Detección asistida de actividades en la imagen

**Feature**: 006-deteccion-asistida | **Date**: 2026-09-25 | Colecciones propiedad de `api`.

## detection_jobs

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | También es el `jobId` de BullMQ |
| `projectId`, `diagramId`, `versionId` | ObjectId | Índice `{versionId, createdAt: -1}` |
| `status` | `queued \| running \| completed \| failed` | |
| `progress` | `{ stage: 'download' \| 'shapes' \| 'ocr' \| 'arrows' \| 'refine', pct: 0–100 }` | |
| `options` | `{ llmRefine: boolean, arrows: boolean }` | |
| `error` | `{ code, message }?` | Mensaje en español, sin detalles internos |
| `metrics` | `{ proposed, accepted, edited, discarded, durationMs, llmUsed }` | `accepted/edited/discarded` se actualizan durante la revisión (FR-009) |
| `requestedBy` | ObjectId | Admin |
| `createdAt`, `startedAt`, `finishedAt` | Date | |

Regla: como máximo un job `queued|running` por versión (índice único parcial).

**Transiciones**: `queued → running → completed | failed`; `failed → queued` (reintentar).

## activity_proposals

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | |
| `jobId`, `versionId` | ObjectId | Índice `{versionId, status}` |
| `bbox` | `{x, y, w, h}` normalizado 0–1 | |
| `type` | `action \| decision \| start \| end` | |
| `label` | string | Texto leído (puede estar vacío) |
| `confidence` | number 0–1 | + `confidenceLevel: high \| medium \| low` |
| `flags` | string[] | `possible_duplicate`, `llm_added`, `llm_corrected`, `empty_label` |
| `status` | `pending \| accepted \| discarded \| superseded` | |
| `activityId` | ObjectId? | Actividad creada al aceptar |
| `reviewedBy`, `reviewedAt` | | |

## transition_proposals

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | |
| `jobId`, `versionId` | ObjectId | |
| `fromProposalId`, `toProposalId` | ObjectId | Deben estar `accepted` para poder aceptar la transición |
| `confidence` | number 0–1 | |
| `status` | `pending \| accepted \| discarded \| superseded` | |

## Cambios en entidades existentes

- `activities.source = 'detected'` al aceptar (campo ya previsto en la 003).
- **Publicación** (003): se añade la condición "0 `activity_proposals` o `transition_proposals`
  en `pending` para la versión" → si no se cumple, `422` con el conteo.

## Migración

`20261022000000-detection-indexes.js`: índices anteriores y el índice único parcial de jobs
activos; `down` los elimina.
