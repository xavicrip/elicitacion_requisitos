# Data Model: Exportación de requisitos y reportes

**Feature**: 008-exportacion-resultados | **Date**: 2026-09-25

## exports — propiedad de `api`; **compartida** con `analytics` para los PDF (solo `status`, `fileKey`, `bytes`, `readyAt`, `expiresAt`, `error`)

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | También es el `jobId` si es asíncrona |
| `projectId` | ObjectId | Índice `{projectId, createdAt: -1}` |
| `format` | `csv \| xlsx \| gherkin \| pdf` | |
| `options` | `{ delimiter?: 'comma' \| 'semicolon', includePending?: boolean }` | |
| `filters` | igual que `analysis_runs.filters` (007) | |
| `mode` | `sync \| async` | |
| `status` | `queued \| running \| ready \| failed \| expired` | `sync` → directamente `ready` sin `fileKey` |
| `detailCount` | number | |
| `analysisRunId` | ObjectId? | Solo en PDF |
| `kpiSnapshot` | object? | Solo en PDF (SC-004) |
| `fileKey` | string? | `exports/{projectId}/{exportId}.{ext}` |
| `bytes` | number? | |
| `requestedBy` | ObjectId | Admin |
| `createdAt`, `readyAt`, `expiresAt` | Date | `expiresAt = readyAt + 24 h`; índice `{status, expiresAt}` para la limpieza |
| `error` | `{code, message}?` | |

**Transiciones**:

```text
queued → running → ready → expired
                 ↘ failed
```

## Objetos en el bucket

`exports/{projectId}/{exportId}.{csv|xlsx|zip|pdf}`: regla de ciclo de vida a 2 días; el
manejador de cascada de proyectos (002) borra el prefijo `exports/{projectId}/`.

## Migración

`20261105000000-exports-indexes.js`: índices anteriores; `down` los elimina.
