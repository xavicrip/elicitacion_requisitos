# Data Model: Diagramas de actividades y espacio de trabajo interactivo

**Feature**: 003-diagramas-canvas | **Date**: 2026-09-25 | Colecciones propiedad de `api`.

## diagrams

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | |
| `projectId` | ObjectId → projects | Índice |
| `name` | string | 1–100 caracteres |
| `order` | number | Posición en la lista del proyecto |
| `publishedVersionId` | ObjectId? → diagram_versions | Versión visible para los participantes |
| `createdAt`, `updatedAt` | Date | |

## diagram_versions

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | |
| `diagramId`, `projectId` | ObjectId | Índice `{ diagramId: 1, number: -1 }` |
| `number` | number | 1, 2, 3… por diagrama (único con `diagramId`) |
| `status` | `draft \| published \| archived` | Máx. 1 `published` y 1 `draft` por diagrama |
| `image` | `{ originalKey, displayKey, thumbKey, mime, width, height, bytes }` | `width`/`height` de la imagen display |
| `publishedAt` | Date? | |
| `createdBy` | ObjectId → users | |
| `rev` | number | Concurrencia optimista de la versión |

**Transiciones**:

```text
draft ──publish (≥1 actividad, 0 propuestas pendientes*)──▶ published ──(nueva versión publicada)──▶ archived
```

\* La condición de propuestas pendientes la añade la feature 006.

## activities

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | |
| `versionId`, `diagramId`, `projectId` | ObjectId | Índice `{ versionId: 1 }` |
| `key` | string (UUID) | Estable entre versiones; único con `versionId` |
| `label` | string | 1–120 caracteres |
| `type` | `action \| decision \| start \| end` | |
| `bbox` | `{ x, y, w, h }` | Normalizados en [0, 1]; `w, h > 0`; `x + w ≤ 1`, `y + h ≤ 1` |
| `next` | string[] | `key` de actividades destino de la misma versión (sin duplicados ni autoenlaces) |
| `source` | `manual \| detected` | `detected` lo usa la feature 006 |
| `rev` | number | Se incrementa en cada cambio; se exige en `If-Match` |
| `createdAt`, `updatedAt` | Date | |

**Reglas**:
- Al eliminar una actividad, se retira su `key` de los `next` de las demás (en la misma operación de servicio).
- Borrar una actividad con requisitos (feature 004) exige `?confirm=true`; la 004 registra el conteo.

## Objetos en el bucket

`projects/{projectId}/diagrams/{versionId}/original.{png|jpg|svg}`, `display.webp`, `thumb.webp`.
El manejador de cascada de proyectos (002) borra el prefijo `projects/{projectId}/`.

## Migración

`20261008000000-diagrams-indexes.js`: índices únicos `{diagramId, number}`, `{versionId, key}`
y el índice parcial único `{diagramId: 1}` con `status: "published"`. `down` los elimina.
