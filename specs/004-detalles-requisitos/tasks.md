---
description: "Task list for feature 004-detalles-requisitos"
---

# Tasks: Detalles de requisitos por actividad

**Input**: Design documents from `/specs/004-detalles-requisitos/`
**Prerequisites**: plan.md (incluidos los "Ajustes tras implementar la 002 y la 003"),
spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: OBLIGATORIAS (Principio III). Cada par prueba + implementación va en el mismo commit.
Las pruebas de integración usan MongoDB, Redis y S3 (RustFS) reales (`pnpm test:services:up`
en local; `services` en CI). Las reglas de permisos, estados y la escala del mapa de calor se
prueban como funciones puras; los E2E siguen el patrón de la 003 (`e2e/flows/`, helpers de
`flows/diagrams.ts` y `__canvasState` solo con `E2E_HOOKS`).

**Commits**: Conventional Commits, un commit atómico por tarea o par; el tipo y alcance
sugeridos van al final de cada tarea.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia de usuario de spec.md (US1–US5)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependencias y helpers de E2E

- [X] T001 Añadir `d3-scale-chromatic` y `diff` (jsdiff) con sus tipos a `apps/web/package.json`; comprobar que el bundle inicial no crece (deben ir en el chunk del espacio de trabajo, cargado en diferido como three.js) — `chore(web)`
- [X] T002 [P] Helpers de E2E en `e2e/flows/details.ts`: invitar y aceptar a un Participante por la API, publicar `compra-simple.png` con sus actividades (reutiliza `publishFixture` de `flows/diagrams.ts`) y crear detalles por la API — `test(e2e)`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquemas, migración, modelos, flag, utilidades compartidas, eventos de dominio,
cascada e integración con los dependientes de actividades de la 003

**⚠️ CRITICAL**: ninguna historia puede empezar hasta completar esta fase

- [X] T003 [P] Pruebas de los esquemas `DetailType`, `Priority`, `DetailStatus`, `DetailInput` (Dado/Cuando/Entonces obligatorios de 5–1 000 caracteres con mensajes en español por campo; `authorRole` ≤ 60; ≤ 10 etiquetas de ≤ 30 caracteres, normalizadas: minúsculas, sin espacios repetidos, sin duplicados), `DetailPatch` (al menos un campo), `Detail` (con `permissions`, `votedByMe`, `author`), `StatusChange` (duplicado exige `duplicateOf`, descartado exige `discardReason` ≤ 500), `Comment`, `ActivityCoverage` y `Facet` contra `contracts/details.openapi.yaml`, en `packages/shared/tests/details.test.ts` — `test(shared)`
- [X] T004 Implementar `packages/shared/src/details.ts` y los tipos de eventos de `contracts/domain-events.md` en `packages/shared/src/events.ts`; exportarlos desde `packages/shared/src/index.ts` — `feat(shared)`
- [X] T005 [P] Prueba de la migración en `apps/api/tests/integration/details-migration.test.ts`: `details` con `{diagramId, activityKey, status}`, `{diagramId, activityKey, voteCount: -1, createdAt: -1}` (plan, ajuste 10), `{projectId, createdAt}`, `{projectId, status}` y el índice de texto en español sobre `given, when, then`; `detail_votes` con único `{detailId, userId}` y `{projectId}`; `detail_comments` con `{detailId, createdAt}` y `{projectId}`; `detail_history` con `{detailId, rev}` y `{projectId}`; `destructive === false`; `down` elimina los índices y conserva los datos, con el bucle de `down` hasta esta migración (como la prueba de la 003) — `test(api)`
- [X] T006 Crear `apps/api/migrations/20261015000000-details-indexes.js` — `feat(api)`
- [X] T007 [P] Modelos Mongoose `apps/api/src/modules/details/models/{detail,vote,comment,history}.ts` (con `autoIndex: false`, `rev`, `voteCount`/`commentCount` y `projectId` también en `detail_history` para la cascada) y prueba de serialización en `apps/api/tests/integration/details-models.test.ts` — `feat(api)`
- [X] T008 [P] Pruebas del flag `details` (desactivado por defecto, plan ajuste 2): `api` responde 404 en `/diagrams/:id/activities/:key/details`, `/details/*`, `/comments/*`, `/diagram-versions/:id/coverage` y `/projects/:id/details/*`, pero no en `/diagram-versions/:id` ni `/projects/:id`; `web` no muestra el panel de detalles (esta parte va con T018, cuando existe el panel), en `apps/api/tests/integration/details-flag.test.ts` — `test(api)`
- [X] T009 Implementar el flag `details` en `packages/shared/src/flags.ts` (`owner: 004-detalles-requisitos`, sustituye a `coverage-overlay`), sus prefijos en `apps/api/src/plugins/flags.ts`, `docs/feature-flags.md` y `FEATURE_FLAGS` de Compose y del job `e2e-smoke` — `feat(shared)`
- [X] T010 [P] Pruebas de `parseIfMatch` (movido a `apps/api/src/lib/if-match.ts`, plan ajuste 6) en `apps/api/tests/unit/if-match.test.ts` y del rate limit por usuario (60 escrituras/min por `request.user.id`, independiente de la IP; `429` con `Retry-After`; plan ajuste 7) en `apps/api/tests/integration/rate-limit.test.ts` — `test(api)`
- [X] T011 Implementar `apps/api/src/lib/if-match.ts` (las actividades de la 003 pasan a usarlo sin cambiar su comportamiento) y `USER_WRITE_RATE_LIMIT` con `keyGenerator` por usuario en `apps/api/src/plugins/rate-limit.ts` — `feat(api)`
- [X] T012 [P] Pruebas de los eventos de dominio en `apps/api/tests/unit/detail-events.test.ts`: emisor tipado (`detail.created`, `detail.updated`, `detail.deleted`, `detail.status_changed`, `detail.reassigned`, `vote.changed`, `comment.*`), sin `permissions` ni `votedByMe` en los payloads, y un suscriptor que falla no interrumpe a los demás (research R10) — `test(api)`
- [X] T013 Implementar `apps/api/src/modules/details/events.ts` (decorado como `app.detailEvents`; la auditoría se suscribe a él) — `feat(api)`
- [X] T014 [P] Pruebas en `apps/api/tests/integration/details-cascade.test.ts`: borrar el proyecto elimina `details`, `detail_votes`, `detail_comments` y `detail_history`, también si el job se reintenta (plan, ajuste 5); y el dependiente `details` de `registerActivityDependents` cuenta los detalles de la `activityKey` pero eliminar la actividad con `?confirm=true` **no** los borra (plan, ajuste 4). Prueba del nuevo texto del aviso en `apps/web/tests/editor.test.tsx` ("quedarán sin actividad al publicar esta versión y podrás reasignarlos") — `test(api)`
- [X] T015 Implementar `apps/api/src/modules/details/cascade.ts` (cascada y dependiente que solo cuenta), registrarlos en `apps/api/src/app.ts` y cambiar el aviso de `apps/web/src/features/diagrams/editor/ActivityForm.tsx` y el comentario de `apps/api/src/modules/diagrams/activities.service.ts` — `feat(api)`

**Checkpoint**: fundaciones listas; `pnpm test`, `pnpm e2e` y el despliegue siguen en verde con el flag desactivado

---

## Phase 3: User Story 1 - Registrar un detalle en una actividad (Priority: P1) 🎯 MVP

**Goal**: al seleccionar una actividad, el panel muestra sus detalles (ordenados por votos y
fecha) y, con el proyecto abierto, el formulario Dado/Cuando/Entonces con tipo, prioridad, rol y
etiquetas

**Independent Test**: quickstart.md §1

### Tests for User Story 1 ⚠️

- [X] T016 [P] [US1] Pruebas de contrato de `GET/POST /diagrams/:id/activities/:key/details` y `GET /projects/:id/details/facets` en `apps/api/tests/contract/details.contract.test.ts` — `test(api)`
- [X] T017 [P] [US1] Pruebas de integración en `apps/api/tests/integration/details-create.test.ts`: falta Dado, Cuando o Entonces → `400` con el campo; `activityKey` que no está en la versión publicada, o diagrama sin versión publicada → `404` (plan, ajuste 4); proyecto `closed` o `draft` → `409 PROJECT_NOT_OPEN` (ajuste 3); no miembro → `404`; un Administrador también registra; la lista se ordena por votos efectivos (incluidos los de sus duplicados, research R6) y luego por fecha, con `author`, `permissions` y `votedByMe` del usuario; filtra por `status`, `type`, `priority` y `tag` y ordena con `sort=votes|recent` (FR-012); el texto con HTML se guarda y devuelve literal; las etiquetas se normalizan; `facets` devuelve roles y etiquetas usados con su frecuencia; `lastActivityAt`, auditoría `detail.created`, evento emitido y rate limit por usuario — `test(api)`
- [ ] T018 [P] [US1] Pruebas de `DetailsPanel`, `DetailForm` y `DetailCard` en `apps/web/tests/details-panel.test.tsx`: se abre al seleccionar una actividad y la lista muestra autor y fecha; errores por campo; contador de caracteres que avisa cerca de 1 000; sugerencias de rol y etiquetas; HTML mostrado como texto; sin formulario en un proyecto cerrado; en `DetailsWorkspacePage`, un Administrador con borrador y versión publicada puede cambiar entre ambas (plan, ajuste 8) — `test(web)`
- [ ] T019 [P] [US1] E2E en `e2e/flows/details-create.spec.ts`: un Participante selecciona "Validar pago" (clic en su zona, con `__canvasState`), registra un detalle y lo ve con su nombre al recargar; "Entonces" vacío → bloqueado con el campo señalado; en un proyecto cerrado no hay formulario — `test(e2e)`

### Implementation for User Story 1

- [X] T020 [US1] Implementar en `apps/api/src/modules/details/service.ts` el alta y la lista (validación del ancla contra la versión publicada, `permissions` calculadas según research R5, filtros y orden por votos efectivos, facets) y sus rutas en `apps/api/src/modules/details/routes.ts` (`requireProjectRole`/`requireResourceProject`, `requireProjectStatus('open')`, rate limit por usuario), registradas en `apps/api/src/app.ts` — `feat(api)`
- [ ] T021 [US1] Implementar `apps/web/src/features/details/{api.ts,DetailsPanel.tsx,DetailForm.tsx,DetailCard.tsx}` y `DetailsWorkspacePage.tsx`, que envuelve `WorkspacePage` con `sidePanel` y el cambio *Borrador / Publicada* para el Administrador, en la ruta `/proyectos/:projectId/diagramas/:diagramId` detrás del flag `details` (sin él, `WorkspacePage` como en la 003); por debajo de 768 px el panel va bajo el canvas — `feat(web)`

**Checkpoint**: US1 funcional; quickstart §1 en verde

---

## Phase 4: User Story 2 - Editar y eliminar mis detalles (Priority: P1)

**Goal**: el autor edita o elimina sus detalles pendientes (el Administrador, cualquiera), con
historial de cambios y aviso de conflicto si otra persona lo modificó

**Independent Test**: quickstart.md §2

### Tests for User Story 2 ⚠️

- [ ] T022 [P] [US2] Pruebas de contrato de `PATCH /details/:id` (con `If-Match`), `DELETE /details/:id` y `GET /details/:id/history` en `apps/api/tests/contract/details-edit.contract.test.ts` — `test(api)`
- [ ] T023 [P] [US2] Pruebas de integración en `apps/api/tests/integration/details-edit.test.ts`: el autor edita su detalle `pending`; otro Participante → `403`; el Administrador edita y elimina cualquiera; un detalle `validated` solo lo edita el Administrador; sin `If-Match` → `428`; `rev` desactualizado → `409` con el detalle actual; cada edición guarda en `detail_history` la versión anterior con `editedBy`, `editedAt` y `change: edit`; eliminar borra también sus votos, comentarios e historial; los detalles de un miembro retirado conservan su nombre; proyecto cerrado → `409`; auditoría, eventos y `lastActivityAt` — `test(api)`
- [ ] T024 [P] [US2] Pruebas en `apps/web/tests/details-edit.test.tsx`: editar un detalle propio; sin acciones en los ajenos; `ConflictDialog` muestra las diferencias campo a campo (jsdiff) con "Conservar lo mío" (reenvía con el `rev` nuevo) y "Usar la versión actual"; `HistoryDrawer` con la línea de tiempo; eliminar pide confirmación e indica que se borran sus votos y comentarios — `test(web)`
- [ ] T025 [P] [US2] E2E en `e2e/flows/details-edit.spec.ts`: el autor edita su detalle y el historial muestra la versión anterior; otro Participante no ve editar ni eliminar; el autor y el Administrador editan el mismo detalle en dos navegadores → el segundo ve `ConflictDialog` — `test(e2e)`

### Implementation for User Story 2

- [ ] T026 [US2] Implementar la edición (`rev` + `If-Match`, historial previo a cada cambio), la eliminación en cascada del detalle y el historial en `apps/api/src/modules/details/{service.ts,routes.ts}` — `feat(api)`
- [ ] T027 [US2] Implementar la edición y eliminación en `DetailCard.tsx`, `ConflictDialog.tsx` y `HistoryDrawer.tsx` en `apps/web/src/features/details/` — `feat(web)`

**Checkpoint**: US1 y US2 funcionan; quickstart §2 en verde

---

## Phase 5: User Story 3 - Indicadores de cobertura en el diagrama (Priority: P2)

**Goal**: contadores por actividad, marca "sin detalles", mapa de calor con leyenda y notas
desplegables, alimentados por el endpoint de cobertura

**Independent Test**: quickstart.md §3

### Tests for User Story 3 ⚠️

- [ ] T028 [P] [US3] Prueba de contrato de `GET /diagram-versions/:id/coverage` en `apps/api/tests/contract/coverage.contract.test.ts` — `test(api)`
- [ ] T029 [P] [US3] Pruebas de integración en `apps/api/tests/integration/coverage.test.ts`: `total` excluye `discarded` y `duplicate`; `byStatus` por estado; `effectiveVotes` suma los votos de sus duplicados; `top` con ≤ 3 resúmenes "Cuando … → Entonces …" de ≤ 80 caracteres ordenados por votos (research R8); solo cuentan las `activityKey` de la versión consultada, no los huérfanos; actividades sin detalles con `total: 0`; un Participante solo consulta versiones publicadas (un borrador → `404`); no miembro → `404` — `test(api)`
- [ ] T030 [P] [US3] Pruebas puras y de componentes en `apps/web/tests/coverage.test.tsx`: escala por cuantiles del mapa de calor y cortes de la leyenda; `colorFor` solo con la capa `heatmap` activa; contador y marca "sin detalles" con texto e icono (no solo color, WCAG 1.4.1); notas con ≤ 3 resúmenes, plegables; la cobertura se vuelve a pedir tras crear, editar, moderar o eliminar un detalle — `test(web)`
- [ ] T031 [P] [US3] E2E en `e2e/flows/coverage.spec.ts` sobre `compra-simple.png` (6 actividades) con detalles en 3: 3 contadores y 3 marcas "sin detalles"; activar *Mapa de calor* muestra la leyenda; desplegar las notas de "Validar pago" — `test(e2e)`

### Implementation for User Story 3

- [ ] T032 [US3] Implementar la agregación de cobertura (research R7) y `apps/api/src/modules/details/coverage.routes.ts` con `requireResourceProject` y la visibilidad de versiones de la 003 — `feat(api)`
- [ ] T033 [US3] Implementar `apps/web/src/features/details/overlays/{CoverageBadges.tsx,Heatmap.ts,HeatmapLegend.tsx,StickyNotes.tsx}` con `renderBadge`, `colorFor` y `overlays.heatmap` de la 003, y el botón *Mapa de calor* en `DetailsWorkspacePage.tsx` — `feat(web)`
- [ ] T034 [US3] Ampliar `e2e/perf/workspace.perf.spec.ts` con los indicadores y el mapa de calor activos sobre `cien-actividades.png` y comprobar ≥ 50 FPS (plan, ajuste 9); si no se cumple, dibujar los contadores como sprites en lugar de `Html` — `perf(web)`

**Checkpoint**: US1–US3 funcionan; quickstart §3 en verde

---

## Phase 6: User Story 4 - Votar y comentar detalles (Priority: P2)

**Goal**: votar (+1) los detalles ajenos y retirar el voto; comentar, editar y eliminar los
comentarios propios

**Independent Test**: quickstart.md §4

### Tests for User Story 4 ⚠️

- [ ] T035 [P] [US4] Pruebas de contrato de `PUT/DELETE /details/:id/vote`, `GET/POST /details/:id/comments` y `PATCH/DELETE /comments/:id` en `apps/api/tests/contract/votes-comments.contract.test.ts` — `test(api)`
- [ ] T036 [P] [US4] Pruebas de integración en `apps/api/tests/integration/votes-comments.test.ts`: votar es idempotente y `voteCount` es exacto también con votos simultáneos (índice único, research R4); retirar el voto; votar el propio detalle → `403`; votar un detalle *duplicado* o *descartado* → `409`, aunque sí se puede comentar (FR-008); comentar (1–1 000 caracteres, texto literal) con `commentCount`; editar el comentario propio (`editedAt`); eliminarlo su autor o un Administrador, otro miembro → `403`; proyecto cerrado → `409` para votar y comentar; eventos, auditoría y rate limit por usuario — `test(api)`
- [ ] T037 [P] [US4] Pruebas en `apps/web/tests/votes-comments.test.tsx`: botón de voto con actualización optimista, `aria-pressed` y vuelta atrás si la API falla; deshabilitado en los detalles propios; lista de comentarios con autor y fecha, editar y eliminar los propios — `test(web)`
- [ ] T038 [P] [US4] E2E en `e2e/flows/votes-comments.spec.ts`: Marta vota el detalle de Luis (1) y retira el voto (0); Luis no puede votar el suyo; Marta comenta "¿Aplica también a PayPal?" y aparece con su nombre — `test(e2e)`

### Implementation for User Story 4

- [ ] T039 [US4] Implementar `apps/api/src/modules/details/{votes.routes.ts,comments.routes.ts}` y su lógica en el servicio (`$inc` de los contadores solo si la inserción o el borrado tienen éxito) — `feat(api)`
- [ ] T040 [US4] Implementar los votos y los comentarios en `apps/web/src/features/details/` (`VoteButton.tsx`, `Comments.tsx`, dentro de `DetailCard.tsx`) — `feat(web)`

**Checkpoint**: US1–US4 funcionan; quickstart §4 en verde

---

## Phase 7: User Story 5 - Moderar detalles (Priority: P3)

**Goal**: el Administrador marca los detalles como validados, duplicados de otro o descartados
con motivo; el panel se filtra y ordena; los detalles huérfanos se reasignan

**Independent Test**: quickstart.md §5

### Tests for User Story 5 ⚠️

- [ ] T041 [P] [US5] Pruebas de contrato de `POST /details/:id/status`, `POST /details/:id/reassign` y `GET /projects/:id/details/orphans` en `apps/api/tests/contract/moderation.contract.test.ts` — `test(api)`
- [ ] T042 [P] [US5] Pruebas de integración en `apps/api/tests/integration/moderation.test.ts`: transiciones de data-model.md (las no permitidas → `409`); `duplicate` exige `duplicateOf` del mismo proyecto, distinto del propio y que no sea a su vez duplicado; `discarded` exige motivo ≤ 500; solo el Administrador (`403`); historial con `change: status`; un detalle cuya `activityKey` desaparece al publicar una versión nueva aparece en `orphans` y se reasigna a una `key` de la versión publicada (`change: reassign`); con el proyecto cerrado, moderar y reasignar → `409 PROJECT_NOT_OPEN` (FR-013); auditoría `detail.status_changed` y `detail.reassigned`; eventos — `test(api)`
- [ ] T043 [P] [US5] Pruebas en `apps/web/tests/moderation.test.tsx`: `ModerationMenu` (validar, duplicado con selector del original, descartar con motivo); un duplicado se muestra atenuado con enlace al original; el autor ve el motivo del descarte; filtros por tipo, prioridad, estado y etiqueta y orden por votos o fecha (FR-012); `OrphansPage` permite reasignar — `test(web)`
- [ ] T044 [P] [US5] E2E en `e2e/flows/moderation.spec.ts`: Ana marca un detalle como duplicado (atenuado, con enlace, y sus votos suman en las notas del original), descarta otro con "Fuera de alcance" (Luis ve el motivo), filtra por *Validado* y, al cerrar el proyecto, el formulario y los votos desaparecen — `test(e2e)`

### Implementation for User Story 5

- [ ] T045 [US5] Implementar la moderación, la reasignación y la lista de huérfanos en `apps/api/src/modules/details/{service.ts,routes.ts}` — `feat(api)`
- [ ] T046 [US5] Implementar `ModerationMenu.tsx`, los filtros y el orden de `DetailsPanel.tsx` y `OrphansPage.tsx` (ruta `/proyectos/:projectId/requisitos-huerfanos`, solo Administrador, enlazada desde la lista de diagramas) en `apps/web/src/features/details/` — `feat(web)`

**Checkpoint**: las cinco historias funcionan; quickstart §1–§5 en verde

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T047 [P] Ampliar `apps/api/tests/integration/authorization.matrix.test.ts` con las filas de detalles, votos, comentarios, cobertura, facets y huérfanos (anónimo, no miembro, autor, otro participante, administrador; proyecto `closed`, también para moderar y reasignar; detalle `validated`) — `test(api)`
- [ ] T048 [P] Medir SC-003 (panel de una actividad con 200 detalles en < 1 s) y la cobertura de 100 actividades con 5 000 detalles (< 200 ms p95) con `e2e/perf` y una prueba de rendimiento de `api`; anotarlo en `plan.md` — `perf(api)`
- [ ] T049 [P] ADR `docs/adr/0006-detalles-de-requisitos.md` (ancla por la `activityKey` de una versión publicada, vigente o archivada, y los huérfanos como estado temporal que resuelve el Administrador, en lugar de borrar: así se lee el Principio I; concurrencia con `rev`, contadores de votos con índice único, eventos de dominio en proceso) — `docs(adr)`
- [ ] T050 [P] Actualizar el README (sección de detalles de requisitos: pantallas, flag `details`) y revisar que `quickstart.md` siga al día con lo construido — `docs(repo)`
- [ ] T051 Configurar Railway **antes de fusionar**: `FEATURE_FLAGS=accounts=true,diagrams=true,details=true` en `api` de staging (producción sin cambios) y registrarlo en `docs/adr/0002-despliegue-railway.md` — `docs(infra)`
- [ ] T052 Recorrer quickstart.md en staging (§1–§5) con un Administrador y dos Participantes y repetir las mediciones de T034 y T048; registrar el resultado en `quickstart.md` — `docs(repo)`
- [ ] T053 Activar `details` por defecto (`default: true`) cuando las cinco historias y T052 estén en verde; retirar el flag en un commit posterior y separado (constitución IV) — `feat(shared)`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → historias.
- **US1**: tras la Phase 2. Aporta el panel y `DetailsWorkspacePage`, que usan las demás.
- **US2**: tras US1 (edita los detalles del panel).
- **US3**: tras US1 (cuenta los detalles); independiente de US2.
- **US4**: tras US1; la suma de votos de los duplicados se comprueba en US5.
- **US5**: tras US3 y US4 (los duplicados afectan a la cobertura y a los votos efectivos).
- **Polish**: al final; T051 antes de fusionar a `main`. T053 es la última tarea.

### Within Each User Story

- Pruebas (en rojo) → implementación (en verde) → refactor; cada par se integra en un commit.
- `api` (servicio → rutas) → `web` → E2E en verde.

### Parallel Opportunities

- Phase 1: T002 en paralelo con T001.
- Phase 2: los pares T003–T004, T005–T006, T008–T009, T010–T011, T012–T013 y T014–T015 son independientes entre sí; T007 en paralelo tras T004.
- Tras US1: US2, US3 y US4 pueden avanzar en paralelo (archivos distintos salvo `DetailCard.tsx` y `service.ts`, que se coordinan por orden de commit).
- Cada historia: todas sus pruebas [P] a la vez.

## Parallel Example: User Story 1

```bash
# Pruebas en paralelo (deben fallar):
Task: "Contrato en apps/api/tests/contract/details.contract.test.ts"
Task: "Alta y lista en apps/api/tests/integration/details-create.test.ts"
Task: "Panel y formulario en apps/web/tests/details-panel.test.tsx"
Task: "E2E en e2e/flows/details-create.spec.ts"
```

## Implementation Strategy

### MVP First

1. Phases 1 y 2 → 2. US1 → **validar con quickstart §1** (registrar un detalle en una
   actividad y verlo al recargar).

### Incremental Delivery

US2 → US3 → US4 → US5, cada una integrable en `main` detrás del flag `details` y desplegable
en staging (con `details=true` solo allí). Producción recibe el código en cada release, pero la
funcionalidad solo se activa con T053.

## Notes

- Tareas totales: 53 (Setup 2, Foundational 13, US1 6, US2 6, US3 7, US4 6, US5 6, Polish 7).
- Nunca integrar un commit que rompa `pnpm test` (Principio IV).
- T051 requiere acceso a Railway y lo hace el propietario del proyecto; T052 usa staging.
- La actualización en tiempo real (eventos por Socket.IO) llega con la 005; aquí los eventos de
  dominio solo alimentan la auditoría y la UI se actualiza al recargar o al volver a abrir el
  panel.
- Cambios tras `/speckit-analyze`: I1 y I2 → contrato y research R5 (`409 PROJECT_NOT_OPEN`,
  `404`); I3 y C1 → T017, T020; U1 → spec FR-008, contrato, T036; U2 → spec FR-013, T042, T047;
  A1 → T049; U3 y U4 → research R8, data-model, T029; I4 → data-model; I5 → plan; I6 →
  quickstart.
