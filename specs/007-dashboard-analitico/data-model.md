# Data Model: Dashboard analítico con minería de datos y de texto

**Feature**: 007-dashboard-analitico | **Date**: 2026-09-25

## analysis_runs — propiedad de `api`

El worker no accede a MongoDB (plan, ajuste 1): `api` crea el documento, exporta la entrada al
bucket, procesa el retorno del job y guarda los resultados.

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | También es el `jobId` |
| `projectId` | ObjectId | Índice `{projectId, createdAt: -1}` |
| `trigger` | `manual \| scheduled` | |
| `kind` | `full \| insights` | `insights` = regeneración solo de esa etapa sobre un run anterior |
| `filters` | `{ diagramIds?, from?, to?, types?, statuses }` | Los de lo descriptivo; `statuses` por defecto `pending`, `validated` |
| `status` | `pending \| running \| done \| failed` | Constitución VI |
| `partial` | boolean | `done` con alguna etapa fallida |
| `progress` | `{ stage, pct }` | |
| `stages` | `{ [etapa]: { status: done \| failed \| skipped, reason?, durationMs? } }` | Del retorno del job |
| `dataFingerprint` | `{ count, maxUpdatedAt }` | Para detectar la obsolescencia |
| `detailCount` | number | Detalles analizados (los duplicados cuentan una vez) |
| `inputKey`, `resultsKey` | string | `projects/{projectId}/analysis/{runId}/input.json.gz` y `…/results.json.gz` en el bucket |
| `error` | `{code, message}?` | Mensaje en español para el Administrador |
| `requestedBy` | ObjectId? | Null si es programado |
| `createdAt`, `startedAt`, `finishedAt` | Date | |

Regla: máximo 1 run `pending|running` por proyecto (índice único parcial). Se conservan los
10 últimos runs por proyecto; al borrar uno se borran también sus archivos del bucket. Al borrar
el proyecto, la cascada elimina sus runs, decisiones, valoraciones y ajustes, y
`deletePrefix(projects/{id})` sus archivos.

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
| `schedule` | `{ enabled: boolean, cron: string, timezone: string }` | Por defecto `{false, "0 3 * * *", "America/Guayaquil"}` (se activa por proyecto: el análisis tiene coste) |

## Sin colecciones compartidas

`analytics` no lee `details`, `activities` ni `diagram_versions`: recibe en el archivo de entrada
los detalles filtrados (sin `authorId` ni datos del autor, con `authorRole`), los nombres de las
actividades de la versión publicada y las decisiones de duplicados previas.

## Migración

`20261029000000-analysis-indexes.js`: los índices anteriores y el único parcial de runs
`pending|running` por proyecto; `down` los elimina y conserva los datos.
