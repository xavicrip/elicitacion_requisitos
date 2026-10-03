# Data Model: Exportación de requisitos y reportes

**Feature**: 008-exportacion-resultados | **Date**: 2026-09-25 (actualizado 2026-10-03)

## exports — propiedad exclusiva de `api`

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | También es el `jobId` si es asíncrona |
| `projectId` | ObjectId | Índice `{projectId, createdAt: -1}` |
| `format` | `csv \| xlsx \| gherkin \| pdf` | |
| `options` | `{ delimiter: 'comma' \| 'semicolon', includePending: boolean }` | Por defecto `comma` y `false` |
| `filters` | `DashboardFilters` (007) | |
| `mode` | `sync \| async` | `sync`: ≤ 1 000 detalles y formato distinto de PDF |
| `status` | `pending \| running \| done \| failed` | Constitución VI. `sync` → `done` sin `fileKey` |
| `detailCount` | number | |
| `analysisRunId` | ObjectId? | Solo en PDF: el último análisis terminado, si lo hay |
| `fileKey` | string? | `projects/{projectId}/exports/{exportId}.{ext}`; se vacía al caducar |
| `fileName` | string? | Nombre de descarga (`reqcanvas-<proyecto>-<AAAAMMDD-HHmm>.<ext>`) |
| `bytes` | number? | |
| `requestedBy` | ObjectId | Administrador |
| `createdAt`, `finishedAt`, `expiresAt` | Date | `expiresAt = finishedAt + 24 h`; índice `{expiresAt}` parcial (`fileKey` presente) para la limpieza |
| `error` | `{code, message}?` | `EXPORT_FAILED`, `NO_DIAGRAMS`, `TIMEOUT`, `WORKER_UNAVAILABLE` |

**Transiciones**:

```text
pending → running → done
                  ↘ failed
```

La caducidad no es un estado: el DTO expone `expired = expiresAt < ahora` y la limpieza horaria
borra el archivo y vacía `fileKey`.

## Objetos en el bucket

- `projects/{projectId}/exports/{exportId}.{csv|xlsx|zip|pdf}`: el archivo generado.
- `projects/{projectId}/exports/{exportId}/input.json.gz`: entrada del PDF; se borra al terminar.

Quedan bajo el prefijo del proyecto: la cascada de borrado de la 003 los elimina.
`registerExportsCascade` borra los documentos de `exports` del proyecto.

## Migración

`20261105000000-exports-indexes.js`: los dos índices anteriores; `down` los elimina.
