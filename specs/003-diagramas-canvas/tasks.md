---
description: "Task list for feature 003-diagramas-canvas"
---

# Tasks: Diagramas de actividades y espacio de trabajo interactivo

**Input**: Design documents from `/specs/003-diagramas-canvas/`
**Prerequisites**: plan.md (incluidos los "Ajustes tras implementar la 001 y la 002"),
spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: OBLIGATORIAS (Principio III). Cada par prueba + implementación va en el mismo commit.
Las pruebas de integración usan MongoDB, Redis y S3 (RustFS) reales (`pnpm test:services:up`
en local; `services` en CI). La lógica de cámara, coordenadas y edición se prueba con funciones
puras; los E2E comprueban el estado expuesto del canvas (`window.__canvasState`), nunca capturas
de WebGL (plan, ajuste 8).

**Commits**: Conventional Commits, un commit atómico por tarea o par; el tipo y alcance
sugeridos van al final de cada tarea.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia de usuario de spec.md (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependencias, fixtures y el bucket S3 en el entorno local

- [X] T001 Añadir a `apps/api/package.json` `@fastify/multipart`, `file-type` y `sharp`; comprobar que `docker build -f apps/api/Dockerfile .` usa los binarios de `sharp` para Alpine (musl) y sigue por debajo de 300 MB (plan, ajuste 10) — `chore(api)`
- [X] T002 [P] Añadir `@react-three/drei` 10 a `apps/web/package.json` (compatible con `@react-three/fiber` 9 y React 19, ya instalados) — `chore(web)`
- [X] T003 [P] Generar los diagramas de prueba con un script reproducible `scripts/fixtures/diagrams.mjs` (usa `sharp`): `compra-simple.png` (6 actividades dibujadas), `grande-4000x3000.png`, `cien-actividades.png` (100 cajas en rejilla, con sus coordenadas en un JSON), `con-script.svg` (con `<script>` y una referencia externa) y `enorme-12000.png` (≤ 10 MB), con sus actividades en JSON, en `e2e/fixtures/diagrams/`, que también leen las pruebas de `api`. El archivo de más de 10 MB no se guarda en git: las pruebas lo generan en memoria — `test(e2e)`
- [X] T004 [P] Añadir el servicio `s3` (RustFS, mismas credenciales que `infra/docker-compose.test.yml`) a `infra/docker-compose.yml`, con las variables `S3_*` y `S3_CREATE_BUCKET=true` en `api` (plan, ajuste 2) — `chore(infra)`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: configuración, esquemas, migración, modelos, almacenamiento, procesamiento de
imágenes, guards por recurso, flag y la lógica pura del canvas que usan todas las historias

**⚠️ CRITICAL**: ninguna historia puede empezar hasta completar esta fase

- [X] T005 [P] Pruebas de `loadEnv` para `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (obligatorias; el error nombra la variable sin mostrar el valor), `S3_REGION` (defecto `auto`), `S3_FORCE_PATH_STYLE` y `S3_CREATE_BUCKET` (defecto `false`) en `apps/api/tests/unit/env.test.ts` — `test(api)`
- [X] T006 Implementar las variables de T005 en `apps/api/src/config/env.ts`, pasarlas a `buildApp` desde `apps/api/src/server.ts` y documentarlas en `.env.example` y `specs/001-plataforma-base/contracts/env-vars.md` (referencias al bucket de cada entorno, plan ajuste 3) — `feat(api)`
- [X] T007 [P] Pruebas de los esquemas `DiagramSummary`, `DiagramVersion`, `Activity`, `ActivityInput`, `ActivityType` y `BBox` (normalizada: `x, y ≥ 0`, `w, h > 0`, `x + w ≤ 1`, `y + h ≤ 1`; `label` 1–120; `next` sin duplicados) contra `contracts/diagrams.openapi.yaml` en `packages/shared/tests/diagrams.test.ts` — `test(shared)`
- [X] T008 Implementar `packages/shared/src/diagrams.ts` y exportarlo desde `packages/shared/src/index.ts` — `feat(shared)`
- [X] T009 [P] Prueba de la migración (índices únicos `{diagramId, number}` y `{versionId, key}`, parciales únicos `{diagramId}` con `status: published` y con `status: draft` (un solo borrador por diagrama, también ante subidas simultáneas), `{projectId}` y `{versionId}`; `destructive === false`; `down` elimina índices y conserva datos) en `apps/api/tests/integration/diagrams-migration.test.ts` — `test(api)`
- [X] T010 Crear `apps/api/migrations/20261008000000-diagrams-indexes.js` (plan, ajuste 7) — `feat(api)`
- [X] T011 [P] Modelos Mongoose `apps/api/src/modules/diagrams/models/{diagram,version,activity}.ts` sobre `app.mongo`, con `autoIndex: false` y `rev` para la concurrencia optimista, y una prueba de serialización en `apps/api/tests/integration/diagrams-models.test.ts` — `feat(api)`
- [X] T012 [P] Pruebas del almacenamiento contra RustFS en `apps/api/tests/integration/storage.test.ts`: `put`, `getStream` (con `ETag` y tamaño), `deletePrefix` (paginado e idempotente), `ensureBucket` solo con `S3_CREATE_BUCKET`, y el check `storage` de `/health/deep` (no de `/health`: una caída del bucket no debe bloquear los despliegues; constitución VI) — `test(api)`
- [X] T013 Implementar `apps/api/src/lib/storage.ts` (`@aws-sdk/client-s3`, cliente único por app), el plugin que lo decora en `app.storage`, el check `storage` de `/health/deep` y la configuración S3 de RustFS en el helper `apps/api/tests/helpers/app.ts` — `feat(api)`
- [X] T014 [P] Pruebas del procesamiento en `apps/api/tests/unit/image-pipeline.test.ts` con las fixtures de T003: PNG y JPEG detectados por *magic bytes* (no por la extensión); PDF y un ejecutable renombrado a `.png` → `UNSUPPORTED_FORMAT`; SVG rasterizado a PNG sin conservar el script ni la referencia externa; `display` WebP con el lado mayor ≤ 8192 px, sin EXIF y con la orientación aplicada; `thumb` de 512 px; `width`/`height` de la versión display; duración registrada — `test(api)`
- [X] T015 Implementar `apps/api/src/lib/image-pipeline.ts` (`file-type` → `sharp`, research R2) — `feat(api)`
- [X] T016 [P] Pruebas de los guards en `apps/api/tests/integration/authorization-guard.test.ts`: `requireProjectStatus(['draft', 'open'])` → `409` en `closed` (plan, ajuste 5) y `requireResourceProject(loader)` para rutas por recurso (`/diagram-versions/:id`, `/activities/:id`): carga el recurso, deduce su proyecto y aplica la membresía (404 si el recurso no existe o no es miembro, igual que en proyectos) — `test(api)`
- [X] T017 Implementar T016 en `apps/api/src/plugins/authorization.ts` (`requireProjectStatus` con lista y `requireResourceProject`) sin cambiar el comportamiento de las rutas de la 002 — `feat(api)`
- [X] T018 [P] Pruebas del flag `diagrams` (desactivado por defecto): `api` responde 404 en `/projects/:id/diagrams*`, `/diagrams/*`, `/diagram-versions/*` y `/activities/*` pero no en `/projects/:id`; `web` oculta la sección de diagramas, en `apps/api/tests/integration/diagrams-flag.test.ts` y `apps/web/tests/diagrams-flag.test.tsx` — `test(api)`
- [X] T019 Implementar el flag `diagrams` en `packages/shared/src/flags.ts` (`owner: 003-diagramas-canvas`, sustituye a `diagram-editor`, plan ajuste 4), los prefijos en `apps/api/src/plugins/flags.ts`, `docs/feature-flags.md` y `FEATURE_FLAGS` de Compose y del job `e2e-smoke` — `feat(shared)`
- [X] T020 [P] Pruebas del registro de dependientes de actividades en `apps/api/tests/integration/activity-dependents.test.ts`: `app.registerActivityDependents(name, { count, remove })` (lo usará la 004 para los requisitos); sin registros, el conteo es 0 — `test(api)`
- [X] T021 Implementar el registro de T020 en `apps/api/src/modules/diagrams/dependents.ts` — `feat(api)`
- [X] T022 [P] Pruebas puras de `apps/web/src/features/diagrams/workspace/camera/zoom.ts` en `apps/web/tests/camera.test.ts`: `fitZoom(viewport, image)`, zoom limitado al 10 %–800 % del ajuste, `screenToImage`/`imageToScreen` (ida y vuelta), `clampPan`, rectángulo del viewport en el minimapa y `centerOn(point)` — `test(web)`
- [X] T023 Implementar `apps/web/src/features/diagrams/workspace/camera/zoom.ts` (research R4) — `feat(web)`
- [X] T024 Implementar el store `apps/web/src/features/diagrams/workspace/store.ts` (Zustand, `WorkspaceState` de `contracts/canvas-ui.md`) y su exposición en `window.__canvasState` solo si `/config.js` trae `e2eHooks: true` (decisión en tiempo de ejecución: la imagen de `web` siempre se construye en modo producción, también en el Compose del CI; plan ajuste 8). `apps/web/docker-entrypoint.sh` escribe `e2eHooks` solo con `E2E_HOOKS=true`, que definen `infra/docker-compose.yml` y el CI y nunca Railway; pruebas en `apps/web/tests/workspace-store.test.ts` y `apps/web/tests/entrypoint.test.sh` — `feat(web)`

**Checkpoint**: fundaciones listas; `pnpm test`, `pnpm e2e --project smoke` y el despliegue siguen en verde con el flag desactivado

---

## Phase 3: User Story 1 - Subir un diagrama al proyecto (Priority: P1) 🎯 MVP

**Goal**: el Administrador sube un PNG, JPG o SVG de hasta 10 MB y lo ve en el espacio de
trabajo en *borrador*; se valida el contenido real

**Independent Test**: quickstart.md §1

### Tests for User Story 1 ⚠️

- [X] T025 [P] [US1] Pruebas de contrato de `GET/POST /projects/:id/diagrams` (multipart), `POST /diagrams/:id/versions`, `GET /diagram-versions/:id` y `GET /diagram-versions/:id/image/{display|thumb}` en `apps/api/tests/contract/diagrams.contract.test.ts` — `test(api)`
- [X] T026 [P] [US1] Pruebas de integración en `apps/api/tests/integration/diagrams-upload.test.ts`: 3 MB PNG → versión 1 en `draft` con sus objetos en `projects/{id}/diagrams/{versionId}/`; > 10 MB → `413` "Máximo 10 MB" sin escribir en el bucket; PDF → `415` con los formatos admitidos; SVG con script → solo se sirve `display.webp`; 12 000 px → display ≤ 8192 px; segunda versión mientras hay un borrador → `409`, también con dos subidas simultáneas (índice parcial único); Participante → `403`; proyecto `closed` → `409`; `lastActivityAt` y auditoría `diagram.created`/`diagram.version_uploaded` — `test(api)`
- [X] T027 [P] [US1] Pruebas de las imágenes en `apps/api/tests/integration/diagram-images.test.ts` (plan, ajuste 1): solo miembros (404 a los demás); un Participante solo ve versiones publicadas; `Cache-Control: private, max-age=31536000, immutable`, `ETag` y `304` con `If-None-Match`; `Content-Type: image/webp` — `test(api)`
- [X] T028 [P] [US1] Prueba de la cascada en `apps/api/tests/integration/diagrams-cascade.test.ts`: borrar el proyecto elimina diagramas, versiones, actividades y los objetos bajo `projects/{id}/`, también si se reintenta (plan, ajuste 6) — `test(api)`
- [X] T029 [P] [US1] Pruebas de `DiagramListPage` y `UploadDialog` (comprobación previa de tamaño y tipo en el navegador, errores de la API, progreso, lista con miniaturas) en `apps/web/tests/diagrams-upload.test.tsx` — `test(web)`
- [X] T030 [P] [US1] E2E en `e2e/flows/diagram-upload.spec.ts`: subir `compra-simple.png` → espacio de trabajo en *Borrador* con la imagen cargada (`__canvasState`); PDF y 15 MB rechazados con su mensaje; `con-script.svg` → la red solo descarga `display.webp`; recargar sirve la imagen desde caché (`304` o caché del navegador) **a través del proxy de `web`** — `test(e2e)`

### Implementation for User Story 1

- [X] T031 [US1] Implementar la subida en `apps/api/src/modules/diagrams/service.ts` (multipart con `limits.fileSize` de 10 MB, pipeline, objetos en el bucket, documentos, `lastActivityAt`, auditoría, log de la subida con tamaño, dimensiones y duración junto al `requestId`; si falla a medias, borra lo subido) — `feat(api)`
- [X] T032 [US1] Implementar `apps/api/src/modules/diagrams/routes.ts` (diagramas, versiones, lectura de versión con sus actividades) y `image.routes.ts` (streaming desde el bucket con caché y `ETag`), y registrarlas en `apps/api/src/app.ts` — `feat(api)`
- [X] T033 [US1] Registrar la cascada `app.registerProjectCascade('diagrams', …)` en `apps/api/src/modules/diagrams/cascade.ts` — `feat(api)`
- [X] T034 [US1] Implementar `DiagramListPage.tsx` y `UploadDialog.tsx` en `apps/web/src/features/diagrams/` y la ruta `/proyectos/:projectId/diagramas` (detrás del flag) — `feat(web)`
- [X] T035 [US1] Implementar el espacio de trabajo mínimo: `WorkspacePage.tsx` y `DiagramCanvas.tsx` (`<Canvas orthographic frameloop="demand">`, plano con la textura servida por `/api`, `MapControls` con zoom y desplazamiento básicos, aviso sin WebGL 2) en `apps/web/src/features/diagrams/workspace/`, ruta `/proyectos/:projectId/diagramas/:diagramId`; excluir `image/*` del `encode` de `apps/web/Caddyfile` (no recomprimir WebP ni debilitar el `ETag`) — `feat(web)`

**Checkpoint**: US1 funcional; quickstart §1 en verde

---

## Phase 4: User Story 2 - Marcar actividades en el diagrama (Priority: P1)

**Goal**: el Administrador dibuja, mueve, redimensiona, nombra, tipifica, conecta y elimina
zonas, con guardado automático y control de concurrencia

**Independent Test**: quickstart.md §2

### Tests for User Story 2 ⚠️

- [X] T036 [P] [US2] Pruebas de contrato de `POST /diagram-versions/:id/activities`, `PATCH /activities/:id` (con `If-Match`) y `DELETE /activities/:id` en `apps/api/tests/contract/activities.contract.test.ts` — `test(api)`
- [X] T037 [P] [US2] Pruebas de integración en `apps/api/tests/integration/activities.test.ts`: `bbox` inválida → `400`; solo en versión `draft` (`409` si no); sin `If-Match` → `428`; `rev` desactualizado → `409` con la versión actual; `next` solo hacia actividades de la misma versión, sin autoenlaces ni duplicados; eliminar retira su `key` de los `next` de las demás; con dependientes registrados (T021), eliminar sin `?confirm=true` → `409` con el conteo y con confirmación los elimina; Participante → `403`; auditoría y `lastActivityAt` — `test(api)`
- [X] T038 [P] [US2] Pruebas puras de la geometría del editor en `apps/web/tests/editor-geometry.test.ts`: dibujar, mover y redimensionar con los 8 *handles* produce `bbox` normalizadas y limitadas a la imagen; teclado (1 px y 10 px con `Shift`) — `test(web)`
- [X] T039 [P] [US2] Pruebas de `useAutosave` (debounce de 500 ms, `If-Match`, un `409` recarga la actividad y avisa "Otro administrador modificó esta actividad") y de `ActivityForm` (nombre, tipo, transiciones, confirmación de borrado con conteo) en `apps/web/tests/editor.test.tsx` — `test(web)`
- [X] T040 [P] [US2] E2E en `e2e/flows/diagram-editor.spec.ts`: marcar 5 actividades con nombre y tipo, conectar dos, recargar y comprobar que se conservan; dos pestañas de Admin mueven la misma zona → la segunda ve el aviso de conflicto — `test(e2e)`

### Implementation for User Story 2

- [X] T041 [US2] Implementar `apps/api/src/modules/diagrams/activities.service.ts` y `activities.routes.ts` (con `requireResourceProject` y `requireProjectStatus(['draft', 'open'])`) — `feat(api)`
- [X] T042 [US2] Implementar la geometría pura `apps/web/src/features/diagrams/editor/geometry.ts`, `EditorLayer.tsx` (dibujar, mover, redimensionar, teclado) y `useAutosave.ts` — `feat(web)`
- [X] T043 [US2] Implementar `ActivityForm.tsx` y `TransitionArrows.tsx` en `apps/web/src/features/diagrams/editor/` y el modo `edit` del espacio de trabajo (solo Admin, versión en borrador, viewport ≥ 768 px) — `feat(web)`

**Checkpoint**: US1 y US2 funcionan; quickstart §2 en verde

---

## Phase 5: User Story 3 - Publicar el espacio de trabajo (Priority: P1)

**Goal**: publicar una versión con al menos una actividad y verla como Participante; nuevas
versiones copian las actividades conservando su `key`

**Independent Test**: quickstart.md §3

### Tests for User Story 3 ⚠️

- [ ] T044 [P] [US3] Pruebas de contrato de `POST /diagram-versions/:id/publish` en `apps/api/tests/contract/publish.contract.test.ts` — `test(api)`
- [ ] T045 [P] [US3] Pruebas de integración en `apps/api/tests/integration/diagrams-publish.test.ts`: sin actividades → `422` con la explicación; publicar deja la versión `published`, archiva la anterior y actualiza `publishedVersionId` de forma atómica (índice parcial único); un Participante solo lista y abre versiones publicadas (un borrador → 404); una nueva versión copia las actividades de la última con la misma `key`, nuevos `_id` y `rev` reiniciado (FR-008); el Participante sigue viendo la versión 1 hasta que se publica la 2; auditoría `diagram.published` — `test(api)`
- [ ] T046 [P] [US3] Ampliar `apps/api/tests/integration/authorization.matrix.test.ts` con las filas de diagramas, versiones, imágenes y actividades (anónimo, no miembro, participante, administrador; proyecto `closed`; borrador frente a publicado) — `test(api)`
- [ ] T047 [P] [US3] Pruebas de `web`: botón "Publicar" (deshabilitado sin actividades, con la explicación), y un Participante ve el diagrama publicado sin herramientas de edición, en `apps/web/tests/diagrams-publish.test.tsx` — `test(web)`

### Implementation for User Story 3

- [ ] T048 [US3] Implementar la publicación (condicionada al `rev` de la versión: dos publicaciones simultáneas no se pisan) y la copia de actividades al subir una versión nueva en `apps/api/src/modules/diagrams/service.ts`, con sus rutas — `feat(api)`
- [ ] T049 [US3] Implementar en `web` la publicación, el estado de cada versión y la vista de solo lectura del Participante — `feat(web)`

**Checkpoint**: US1–US3 funcionan; quickstart §3 en verde

---

## Phase 6: User Story 4 - Navegar el diagrama (Priority: P1)

**Goal**: zoom al cursor (10 %–800 %), desplazamiento, "ajustar", minimapa, resaltado,
selección, teclado y móvil en solo lectura

**Independent Test**: quickstart.md §4

### Tests for User Story 4 ⚠️

- [ ] T050 [P] [US4] Pruebas de `ActivityHotspots` (selección de la zona más pequeña bajo el cursor), `Minimap` (un clic centra la cámara) y `A11yActivityList` (`Tab` + `Enter` selecciona y centra; `aria-live` anuncia la selección; `Esc` deselecciona) en `apps/web/tests/workspace.test.tsx` — `test(web)`
- [ ] T051 [P] [US4] E2E en `e2e/flows/workspace-navigation.spec.ts` sobre `grande-4000x3000.png` publicado, con `__canvasState`: rueda → zoom limitado al 10 %–800 %; `0` ajusta; clic en el minimapa centra; teclado (`Tab`, `Enter`, `+`, `-`, flechas); a 390 px se navega y selecciona pero no hay modo `edit` — `test(e2e)`

### Implementation for User Story 4

- [ ] T052 [US4] Implementar `ActivityHotspots.tsx` (raycasting, resaltado con nombre, selección de la zona más pequeña) y los puntos de extensión `renderBadge`/`colorFor` de `contracts/canvas-ui.md` — `feat(web)`
- [ ] T053 [US4] Implementar `Minimap.tsx`, `A11yActivityList.tsx`, los atajos de teclado, `useWorkspaceEvents()` y el modo solo lectura por debajo de 768 px y en proyectos cerrados (FR-010, FR-012) — `feat(web)`

**Checkpoint**: las cuatro historias funcionan; quickstart §1–§4 en verde

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T054 [P] ADR `docs/adr/0005-imagenes-y-canvas.md` (imágenes servidas por `api` en lugar de URLs prefirmadas, bucket compartido con prefijos, pipeline de `sharp`, three.js con renderizado bajo demanda, estado expuesto para los E2E) — `docs(adr)`
- [ ] T055 [P] Actualizar `specs/003-diagramas-canvas/quickstart.md` (incluidos los comandos de prueba con `@reqcanvas/api`), `research.md` (R1 y R9: RustFS, variables reales) y el README (pantallas, variables `S3_*`, RustFS local) — `docs(repo)`
- [ ] T056 Medir en local, con Playwright y `cien-actividades.png`, los FPS durante zoom y desplazamiento (≥ 50, SC-002) y el tiempo hasta un diagrama navegable con la red limitada a 10 Mbps (< 3 s, SC-003), y el procesamiento de 10 MB (< 5 s); anotarlo en `plan.md` — `perf(web)`
- [ ] T057 Configurar Railway **antes de fusionar** (con el selector de entorno comprobado): `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY` de `api` como referencias al bucket del entorno (`reqcanvas` en producción, `reqcanvas-staging` en staging); `FEATURE_FLAGS` con `diagrams=true` solo en staging; registrarlo en `docs/adr/0002-despliegue-railway.md` — `docs(infra)`
- [ ] T058 Recorrer quickstart.md en staging (§1–§4) con dos navegadores, comprobar que el borde de Railway acepta una subida de 10 MB (plan, ajuste 9) y repetir las mediciones de T056; registrar el resultado en `quickstart.md` — `docs(repo)`
- [ ] T059 Activar `diagrams` por defecto (`default: true`) cuando las cuatro historias y T058 estén en verde; retirar el flag en un commit posterior y separado (constitución IV) — `feat(shared)`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → historias.
- **US1**: tras la Phase 2. Aporta el espacio de trabajo mínimo que usan las demás.
- **US2**: tras US1 (dibuja sobre `DiagramCanvas`).
- **US3**: tras US2 (publicar exige actividades; la copia de actividades usa su modelo).
- **US4**: tras US3 (navega diagramas publicados; algunas piezas, como `Minimap`, pueden empezar tras US1).
- **Polish**: al final; T057 antes de fusionar a `main` (sin `S3_*`, `api` no arranca y Railway mantiene la versión anterior). T059 es la última tarea.

### Within Each User Story

- Pruebas (en rojo) → implementación (en verde) → refactor; cada par se integra en un commit.
- `api` (servicio → rutas) → `web` → E2E en verde.

### Parallel Opportunities

- Phase 1: T002–T004 en paralelo con T001.
- Phase 2: los pares T005–T006, T007–T008, T009–T010, T012–T013, T014–T015, T016–T017, T018–T019, T020–T021 y T022–T023 son independientes entre sí; T011 y T024 en paralelo con ellos.
- Cada historia: todas sus pruebas [P] a la vez.

## Parallel Example: User Story 1

```bash
# Pruebas en paralelo (deben fallar):
Task: "Contrato de diagramas en apps/api/tests/contract/diagrams.contract.test.ts"
Task: "Subida en apps/api/tests/integration/diagrams-upload.test.ts"
Task: "Imágenes en apps/api/tests/integration/diagram-images.test.ts"
Task: "Cascada en apps/api/tests/integration/diagrams-cascade.test.ts"
Task: "DiagramListPage y UploadDialog en apps/web/tests/diagrams-upload.test.tsx"
Task: "E2E en e2e/flows/diagram-upload.spec.ts"
```

## Implementation Strategy

### MVP First

1. Phases 1 y 2 → 2. US1 → **validar con quickstart §1** (subir y ver el diagrama).

### Incremental Delivery

US2 → US3 → US4, cada una integrable en `main` detrás del flag `diagrams` y desplegable en
staging (con `diagrams=true` solo allí). Producción recibe el código en cada release, pero la
funcionalidad solo se activa con T059.

## Notes

- Tareas totales: 59 (Setup 4, Foundational 20, US1 11, US2 8, US3 6, US4 4, Polish 6).
- Nunca integrar un commit que rompa `pnpm test` (Principio IV).
- T057 requiere acceso a Railway y lo hace el propietario del proyecto; T058 usa staging.
- La lista de requisitos de una actividad, su conteo real y el mapa de calor llegan con la 004
  (`registerActivityDependents`, `renderBadge`, `colorFor`). También la decisión sobre los
  requisitos de actividades eliminadas al publicar una versión nueva (edge case de la spec): la
  003 solo conserva la `key` de las actividades copiadas.
- Cambios tras `/speckit-analyze`: C1 → T024; I1 → spec; C2 y U4 → T012, T013; U1 → T009,
  T026; U2 → T030, T035; U3 → T031; U5 → T048; I2 → contrato; I3 → T055; X1 → estas notas.
