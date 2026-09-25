# Research: Detalles de requisitos por actividad

**Feature**: 004-detalles-requisitos | **Date**: 2026-09-25

## R1. Ancla del detalle

- **Decision**: `details` guarda `projectId`, `diagramId` y `activityKey` (no `activityId`).
  Al crear, se valida que la `activityKey` exista en la versión **publicada** del diagrama.
  Un detalle es **huérfano** si su `activityKey` no existe en la versión publicada actual; los
  huérfanos se calculan por consulta y el Administrador puede reasignarlos
  (`POST /details/:id/reassign`).
- **Rationale**: las claves estables de la 003 (R7) mantienen los requisitos entre versiones
  (edge case de la spec).

## R2. Concurrencia de edición

- **Decision**: campo `rev` con `If-Match` en `PATCH /details/:id`. Si no coincide, `409` con el
  detalle actual; el `ConflictDialog` muestra la comparación campo a campo (`jsdiff`) y permite
  "Conservar lo mío" (reenvía con el `rev` nuevo) o "Usar la versión actual".
- **Rationale**: FR-007 (sin pérdidas silenciosas) y escenario 4 de la US2.
- **Alternatives considered**: CRDT o bloqueo pesimista (desproporcionados para textos cortos
  editados normalmente por su autor).

## R3. Historial

- **Decision**: antes de cada actualización se inserta en `detail_history` una copia
  (`snapshot`) de los campos editables, con `rev`, `editedBy` y `editedAt`. Se muestra como una
  línea de tiempo con la diferencia respecto a la versión siguiente.
- **Alternatives considered**: guardar solo la diferencia (menos espacio, pero reconstrucción
  más compleja); el volumen esperado (≤ 5 000 detalles × pocas ediciones) no lo justifica.

## R4. Votos

- **Decision**: colección `detail_votes` con índice único `{detailId, userId}`; `details.voteCount`
  se actualiza con `$inc` solo cuando la inserción o el borrado del voto tienen éxito
  (idempotente). No se puede votar un detalle propio (403).
- **Rationale**: evita votos duplicados bajo concurrencia sin transacciones; el contador
  permite ordenar por votos con índice.
- **Alternatives considered**: array `votes[]` embebido (crece sin límite y dificulta la
  unicidad en escrituras concurrentes).

## R5. Reglas de edición según el estado

| Estado | Autor (Participante) | Administrador |
|--------|----------------------|---------------|
| `pending` | Editar / eliminar | Editar / eliminar / moderar |
| `validated` | Solo lectura | Editar / eliminar / moderar |
| `duplicate` | Solo lectura | Moderar (volver a `pending`) |
| `discarded` | Solo lectura (ve el motivo) | Moderar |

Con el proyecto `closed`, nadie escribe (se responde `423 Locked`).

## R6. Duplicados en los indicadores

- **Decision**: `status = duplicate` exige `duplicateOf` (un detalle del mismo proyecto que no
  sea a su vez duplicado). En la cobertura y la ordenación, los votos del duplicado se suman al
  original (`effectiveVotes`), y el duplicado no cuenta como detalle adicional de la actividad.

## R7. Endpoint de cobertura

- **Decision**: `GET /diagram-versions/:id/coverage` → agregación sobre `details`
  (`$match {diagramId, status ≠ discarded}` → `$group` por `activityKey` con el conteo por
  estado, `effectiveVotes` y los 3 resúmenes más votados para las notas). Índice
  `{diagramId: 1, activityKey: 1, status: 1}`.
- **Rationale**: consulta < 200 ms con 5 000 detalles; sin contadores desnormalizados que
  mantener sincronizados.

## R8. Mapa de calor y notas en el canvas

- **Decision**: color de relleno de cada zona con `interpolateYlOrRd` de d3-scale-chromatic
  sobre una escala por cuantiles del número de detalles, con opacidad 0,45 para no tapar el
  texto del diagrama; leyenda HTML con los cortes. "Sin detalles" = badge gris con icono y texto
  (no solo color, por accesibilidad). Las notas son `Html` de drei, ancladas al borde derecho de
  la zona, colapsables y con un máximo de 3 resúmenes (truncados a 80 caracteres).
- **Rationale**: FR-011 y SC-004; se usa texto y forma además del color (WCAG 1.4.1).

## R9. Sugerencias de rol y etiquetas

- **Decision**: `GET /projects/:id/details/facets` devuelve los valores distintos de
  `authorRole` y `tags`, con su frecuencia, para el autocompletado. Las etiquetas se normalizan
  (minúsculas, sin tildes en la clave, máximo 30 caracteres, máximo 10 por detalle).

## R10. Eventos de dominio

- **Decision**: el servicio emite eventos en un `EventEmitter` tipado dentro del proceso
  (`contracts/domain-events.md`) tras cada escritura exitosa. En esta feature solo los
  consume el log de auditoría; la 005 los publicará por Socket.IO.
- **Rationale**: desacopla la lógica de negocio del transporte de tiempo real (Principio II)
  y permite a la 004 funcionar sin la 005.
