# Implementation Plan: Detalles de requisitos por actividad

**Branch**: `004-detalles-requisitos` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-detalles-requisitos/spec.md`

## Summary

Al seleccionar una actividad del canvas (003), se abre un panel lateral con sus **detalles
de requisitos** (Dado / Cuando / Entonces + tipo, prioridad MoSCoW, rol y etiquetas) y el
formulario de alta. Los detalles se anclan a `(diagramId, activityKey)`, por lo que
sobreviven a nuevas versiones del diagrama. La edición usa concurrencia optimista (`rev` +
`If-Match`) con un diálogo de comparación ante un conflicto; cada cambio queda en
`detail_history`. Hay votos (colección con índice único y contador desnormalizado),
comentarios y moderación por el Administrador (*validado*, *duplicado de…*, *descartado* con
motivo). El canvas muestra contadores, la marca "sin detalles", un mapa de calor con leyenda y
notas desplegables, alimentados por un endpoint de **cobertura** agregado.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 24 LTS
**Primary Dependencies**: `api`: Fastify 5, Mongoose 8, zod. `web`: react-hook-form + zod, TanStack Query (actualizaciones optimistas), drei `Html` para las notas, `d3-scale-chromatic` (escala secuencial del mapa de calor), `jsdiff` (comparación ante un conflicto)
**Storage**: MongoDB (`details`, `detail_votes`, `detail_comments`, `detail_history`); `audit_logs` (002)
**Testing**: Vitest (contrato, integración, matriz de autorización ampliada, reglas de estado); Playwright (alta, edición con conflicto, votos, moderación, indicadores)
**Target Platform**: Web (igual que 003)
**Project Type**: Aplicación web
**Performance Goals**: panel con 200 detalles abierto en < 1 s (SC-003); cobertura de 100 actividades en < 200 ms p95
**Constraints**: texto plano (sin HTML) de hasta 1 000 caracteres por campo; proyecto `closed` = solo lectura; autorización en el servidor
**Scale/Scope**: ≤ 5 000 detalles por proyecto; ≤ 200 por actividad

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento | Estado |
|-----------|--------------|--------|
| I. Requisito anclado a la actividad | `details` exige `diagramId` + `activityKey` existentes y `given/when/then` no vacíos (validación en zod y en Mongoose); `detail_history` da trazabilidad completa. | ✅ |
| II. Servicios desacoplados | Colecciones propiedad de `api`; `details` se declara **de lectura compartida** para `analytics` (007). Esquemas en `packages/shared/src/details.ts`. | ✅ |
| III. Pruebas primero | Contrato por endpoint, matriz de autorización (autor / otro participante / admin / proyecto cerrado) y E2E por historia, antes de implementar. | ✅ |
| IV. Commits atómicos y reversibles | Migración de índices con `down`; los indicadores del canvas se integran tras el flag `coverage-overlay` hasta la US3. | ✅ |
| V. Seguridad por defecto | Texto plano escapado por React (sin `dangerouslySetInnerHTML`); límites de longitud; rate limit de 60 escrituras/min por usuario. | ✅ |
| VI. Observabilidad | Eventos de moderación en `audit_logs`; métricas de latencia del panel en logs. | ✅ |
| VII. Simplicidad | Cobertura por agregación con índice (sin contadores desnormalizados por actividad); historial como documentos de versión completos (sin *event sourcing*). | ✅ |
| Restricciones (v1.1.0) | Node 24; sin cambios de despliegue. | ✅ |

**Re-evaluación post-diseño**: sin violaciones.

## Project Structure

### Documentation (this feature)

```text
specs/004-detalles-requisitos/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── details.openapi.yaml
│   └── domain-events.md      # Eventos que emite el servicio (los consume la 005)
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/details.ts               # DetailInput, Detail, DetailStatus, Priority, Coverage
apps/api/src/modules/details/
├── routes.ts                                # detalles, historial, estado
├── votes.routes.ts
├── comments.routes.ts
├── coverage.routes.ts
├── service.ts                               # reglas de permisos por estado y autor
├── events.ts                                # emisor de eventos de dominio (in-process)
├── models/{detail,vote,comment,history}.ts
└── cascade.ts                               # borrado por proyecto y por actividad
apps/api/migrations/20261015000000-details-indexes.js
apps/web/src/features/details/
├── DetailsPanel.tsx                         # panel lateral (lista + filtros + formulario)
├── DetailForm.tsx                           # Dado/Cuando/Entonces + metadatos
├── DetailCard.tsx                           # votos, comentarios, estado, acciones
├── ConflictDialog.tsx                       # comparación ante 409
├── HistoryDrawer.tsx
├── ModerationMenu.tsx                       # validar / duplicado / descartar
├── OrphansPage.tsx                          # detalles de actividades eliminadas (Admin)
└── overlays/{CoverageBadges.tsx,Heatmap.tsx,HeatmapLegend.tsx,StickyNotes.tsx}
e2e/{details-create,details-edit,votes-comments,moderation,coverage}.spec.ts
```

**Structure Decision**: módulo `details` en `api`; en `web`, la feature se enchufa al
workspace de la 003 mediante los puntos de extensión de `contracts/canvas-ui.md`
(`sidePanel`, `renderBadge`, `colorFor`, `overlays.heatmap`).

## Complexity Tracking

Sin violaciones.
