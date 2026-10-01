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
**Primary Dependencies**: `api`: Fastify 5, Mongoose 9, zod 4. `web`: react-hook-form + zod, TanStack Query (actualizaciones optimistas), drei `Html` para las notas, `d3-scale-chromatic` (escala secuencial del mapa de calor), `jsdiff` (comparación ante un conflicto)
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
e2e/flows/{details-create,details-edit,votes-comments,moderation,coverage}.spec.ts
```

**Structure Decision**: módulo `details` en `api`; en `web`, la feature se enchufa al
workspace de la 003 mediante los puntos de extensión de `contracts/canvas-ui.md`
(`sidePanel`, `renderBadge`, `colorFor`, `overlays.heatmap`).

## Ajustes tras implementar la 002 y la 003 (2026-10-01)

1. **Versiones reales**: Mongoose 9 y zod 4 (no Mongoose 8); errores con `HttpError` y el
   formato `{code, message, fields}` de la 002 (`apps/api/src/lib/errors.ts`, con `extra` para
   datos como `detailCount`).
2. **Toda la feature detrás de un flag `details`** (como `accounts` y `diagrams`; constitución
   IV), no solo los indicadores: sustituye a `coverage-overlay`. Prefijos en
   `apps/api/src/plugins/flags.ts`: `/diagrams/:id/activities/:key/details`, `/details`,
   `/comments`, `/diagram-versions/:id/coverage` y `/projects/:id/details`. Se activa por
   defecto al cerrar la feature.
3. **Autorización con los guards de la 003**: las rutas por recurso (`/details/:id`,
   `/comments/:id`, `/diagram-versions/:id/coverage`) usan `requireResourceProject(loader,
   role)`; las rutas usan el parámetro `:id` que espera el guard. Las escrituras de detalles,
   votos y comentarios son aportes de los miembros: `requireProjectStatus('open')`, que ya
   responde **`409 PROJECT_NOT_OPEN`** (no `423 Locked` como decía research R5). La moderación
   y la reasignación, solo Admin.
4. **Ancla y huérfanos con las versiones de la 003**: un detalle se crea sobre una `activityKey`
   de la versión **publicada** (`404` si el diagrama no tiene versión publicada o la clave no
   está en ella). Al borrar en un borrador una actividad cuya `key` tiene detalles, **no se
   borran**: quedan huérfanos al publicar y el Administrador los reasigna. Por eso el
   dependiente `details` de `registerActivityDependents` (003) solo **cuenta**, su `remove` no
   borra nada, y el aviso del editor de la 003 cambia a "Tiene N requisito(s) asociado(s):
   quedarán sin actividad al publicar esta versión y podrás reasignarlos" (hoy dice que se
   eliminarán).
5. **Cascada** con `app.registerProjectCascade('details', …)`: borra `details`,
   `detail_votes`, `detail_comments` y `detail_history` del proyecto, de forma idempotente.
6. **Concurrencia como en las actividades de la 003**: `rev` + `If-Match` (`428` sin él, `409`
   con el detalle actual en el cuerpo); `parseIfMatch` se mueve a `apps/api/src/lib/` para
   compartirlo. En `web`, `ApiError.body` ya trae el detalle actual para el `ConflictDialog`.
7. **Rate limit por usuario**: el plugin de la 002 limita por IP; las escrituras de esta
   feature usan `config.rateLimit` con `keyGenerator` por `request.user.id` (60/min).
8. **Integración en el espacio de trabajo de la 003**: un `DetailsWorkspacePage` envuelve
   `WorkspacePage` con `sidePanel`, `renderBadge` y `colorFor` y sustituye a `WorkspacePage` en
   la ruta `/proyectos/:projectId/diagramas/:diagramId`. El panel solo aparece en modo vista;
   como el Administrador abre el borrador en modo edición, la página le ofrece cambiar entre
   *Borrador* y *Publicada* cuando existen ambas, para poder ver los detalles mientras prepara
   una versión nueva. Por debajo de 768 px el panel va debajo del canvas.
9. **Rendimiento de los indicadores**: `renderBadge` crea un `Html` de drei por zona. Con
   `cien-actividades.png` hay que mantener ≥ 50 FPS (SC-002 de la 003): `pnpm e2e:perf` se
   amplía con los indicadores y el mapa de calor activos; si no se cumple, los contadores se
   dibujan como sprites en lugar de DOM.
10. **Índices**: el de ordenación del panel lleva el diagrama, `{diagramId, activityKey,
    voteCount: -1, createdAt: -1}`; migración `20261015000000-details-indexes.js` con
    `destructive = false` y `down` que conserva los datos.
11. **E2E en `e2e/flows/`** con los helpers de la 003 (`flows/diagrams.ts`: subir, marcar
    actividades y publicar por la API) y un Participante invitado por la API; `__canvasState`
    solo con `E2E_HOOKS`.
12. **Última actividad y auditoría**: crear, editar, moderar o comentar actualiza
    `projects.lastActivityAt`; los eventos de dominio se consumen en la auditoría (R10).

## Complexity Tracking

Sin violaciones.
