# Data Model: Dashboard analítico con minería de datos y de texto

**Feature**: 007-dashboard-analitico | **Date**: 2026-09-25

## analysis_runs — **compartida** (`api` crea; `analytics` actualiza `status`, `progress`, `results`, `error`, `startedAt`, `finishedAt`)

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | También es el `jobId` |
| `projectId` | ObjectId | Índice `{projectId, createdAt: -1}` |
| `trigger` | `manual \| scheduled` | |
| `filters` | `{ diagramIds?, from?, to?, types?, includeStatuses }` | `includeStatuses` por defecto: `pending`, `validated` |
| `status` | `queued \| running \| completed \| partial \| failed` | `partial` si alguna etapa falló |
| `progress` | `{ stage, pct }` | |
| `dataFingerprint` | `{ count, maxUpdatedAt }` | Para detectar la obsolescencia |
| `detailCount` | number | Detalles analizados (los duplicados cuentan una vez) |
| `results` | `AnalysisResults` | Esquema en `contracts/analysis-results.schema.json` (`schemaVersion: 1`) |
| `error` | `{code, message}?` | |
| `requestedBy` | ObjectId? | Null si es programado |
| `createdAt`, `startedAt`, `finishedAt` | Date | |

Regla: máximo 1 run `queued|running` por proyecto (índice único parcial). Se conservan los
10 últimos runs por proyecto (limpieza tras completar).

## analysis_embeddings — propiedad de `analytics` (caché)

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | string | `sha256(model + texto normalizado)` |
| `vector` | Binary (float32 × 384) | |
| `createdAt` | Date | Índice TTL de 180 días |

## duplicate_decisions — propiedad de `api`

| Campo | Tipo | Reglas |
|-------|------|--------|
| `projectId` | ObjectId | |
| `pair` | `[detailIdA, detailIdB]` ordenado | Índice único `{projectId, pair}` |
| `decision` | `confirmed \| rejected` | `confirmed` también aplica la moderación de la 004 |
| `similarity` | number | |
| `decidedBy`, `decidedAt` | | |

## insight_feedback — propiedad de `api`

| Campo | Tipo | Reglas |
|-------|------|--------|
| `projectId`, `runId` | ObjectId | |
| `insightId` | string | ID dentro de `results.insights` |
| `useful` | boolean | |
| `statement` | string | Copia del texto (para las instrucciones futuras) |
| `userId`, `at` | | |

## analysis_settings — propiedad de `api` (1 por proyecto)

| Campo | Tipo | Reglas |
|-------|------|--------|
| `projectId` | ObjectId | Único |
| `extraAmbiguousTerms` | string[] | ≤ 100 |
| `extraStopwords` | string[] | ≤ 200 |
| `schedule` | `{ enabled: boolean, cron: string, timezone: string }` | Por defecto `{true, "0 3 * * *", "America/Guayaquil"}` |

## Lecturas compartidas (declaradas en la 004)

`analytics` lee `details` (proyección **sin** `authorId`), `activities` y `diagram_versions`
(etiquetas de actividad) del proyecto indicado en el job.

## Migración

`20261029000000-analysis-indexes.js`: índices anteriores, índice único parcial de runs
activos e índice TTL de `analysis_embeddings`; `down` los elimina.
