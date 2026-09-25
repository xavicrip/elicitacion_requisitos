# Data Model: Detalles de requisitos por actividad

**Feature**: 004-detalles-requisitos | **Date**: 2026-09-25 | Propiedad de `api`. `details`,
`detail_votes` y `detail_comments` son de **lectura compartida** para `analytics` (007).

## details

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | |
| `projectId`, `diagramId` | ObjectId | |
| `activityKey` | string (UUID) | Debe existir en la versión publicada al crearse |
| `given` | string | Obligatorio; 5–1 000 caracteres; texto plano (Dado / contexto) |
| `when` | string | Obligatorio; 5–1 000 caracteres (Cuando / acción) |
| `then` | string | Obligatorio; 5–1 000 caracteres (Entonces / resultado) |
| `type` | `functional \| non_functional \| business_rule \| constraint` | Obligatorio |
| `priority` | `must \| should \| could \| wont` \| null | |
| `authorRole` | string \| null | ≤ 60 caracteres |
| `tags` | string[] | ≤ 10; cada una ≤ 30 caracteres, normalizada |
| `status` | `pending \| validated \| duplicate \| discarded` | Inicial `pending` |
| `duplicateOf` | ObjectId? | Obligatorio si `status = duplicate`; ≠ `_id`; el destino no puede ser `duplicate` |
| `discardReason` | string? | Obligatorio si `status = discarded`; ≤ 500 caracteres |
| `voteCount` | number | ≥ 0; mantenido con `$inc` |
| `commentCount` | number | ≥ 0 |
| `authorId` | ObjectId → users | |
| `rev` | number | Concurrencia optimista |
| `createdAt`, `updatedAt` | Date | |

**Índices**: `{diagramId, activityKey, status}`, `{projectId, createdAt}`,
`{projectId, status}`, `{activityKey, voteCount: -1, createdAt: -1}`, índice de texto sobre
`given, when, then` (idioma `spanish`).

**Transiciones de estado** (solo Admin):

```text
pending ⇄ validated
pending ⇄ duplicate (requiere duplicateOf)
pending ⇄ discarded (requiere discardReason)
validated → duplicate | discarded (y vuelta a pending)
```

## detail_votes

| Campo | Tipo | Reglas |
|-------|------|--------|
| `detailId` | ObjectId | Índice único `{detailId, userId}` |
| `userId` | ObjectId | ≠ `details.authorId` |
| `projectId` | ObjectId | Para la cascada |
| `createdAt` | Date | |

## detail_comments

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | |
| `detailId`, `projectId` | ObjectId | Índice `{detailId, createdAt}` |
| `authorId` | ObjectId | |
| `text` | string | 1–1 000 caracteres, texto plano |
| `editedAt` | Date? | |
| `createdAt` | Date | |

## detail_history

| Campo | Tipo | Reglas |
|-------|------|--------|
| `detailId` | ObjectId | Índice `{detailId, rev}` |
| `rev` | number | `rev` del detalle antes del cambio |
| `snapshot` | `{given, when, then, type, priority, authorRole, tags, status, duplicateOf?, discardReason?}` | |
| `editedBy` | ObjectId | |
| `editedAt` | Date | |
| `change` | `edit \| status \| reassign` | |

## Vista calculada: Coverage (por versión de diagrama)

```ts
type ActivityCoverage = {
  activityKey: string;
  total: number;                 // excluye discarded y duplicate
  byStatus: Record<DetailStatus, number>;
  effectiveVotes: number;        // incluye votos de sus duplicados
  top: { id: string; summary: string }[]; // ≤ 3, para las notas
};
```

## Migración

`20261015000000-details-indexes.js`: crea los índices; `down` los elimina.
