---
description: "Task list for feature 006-deteccion-asistida"
---

# Tasks: Detección asistida de actividades en la imagen

**Input**: Design documents from `/specs/006-deteccion-asistida/`
**Prerequisites**: plan.md (incluidos los "Ajustes tras implementar la 002, la 003, la 004 y la
005"), spec.md, research.md, data-model.md, contracts/detection-job.md,
contracts/detection.openapi.yaml, quickstart.md

**Tests**: OBLIGATORIAS (Principio III). Cada par prueba + implementación va en el mismo commit.
Las pruebas de `api` usan MongoDB, Redis y RustFS reales (`pnpm test:services:up`) y un **worker
falso en Node** que consume la cola `detection` y devuelve un `DetectionResult` fijo (plan,
ajuste 12); los tiempos (timeout del job, latido del worker) se inyectan por opciones. Las de
`analytics` usan pytest con imágenes sintéticas y el conjunto de validación; Tesseract se instala
en el job `test-python` del CI. Los E2E siguen el patrón de la 004 y la 005 (`e2e/flows/`,
`__canvasState` solo con `E2E_HOOKS`) contra Compose con el worker real.

**Commits**: Conventional Commits, un commit atómico por tarea o par; el tipo y alcance
sugeridos van al final de cada tarea.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia de usuario (US1–US3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependencias, documentos al día con los ajustes del plan, conjunto de validación y
helpers de E2E

- [X] T001 ADR `docs/adr/0008-deteccion-asistida.md` antes de introducir las tecnologías nuevas (restricciones de la constitución): OpenCV + Tesseract en lugar de un detector entrenado, `bullmq` de Python con el de Node, SDK `anthropic` para el refinamiento opcional, el worker no escribe en MongoDB, propuestas con revisión humana obligatoria, condiciones de publicación por registro y servicio `analytics-worker` aparte en Railway con su `/health` — `docs(adr)`
- [X] T002 Añadir a `apps/analytics/pyproject.toml` (con `uv add`) `opencv-python-headless`, `numpy`, `pytesseract`, `bullmq` y `anthropic`; instalar `tesseract-ocr`, `tesseract-ocr-spa` y `tesseract-ocr-eng` en la etapa `runtime` de `apps/analytics/Dockerfile` y en el job `test-python` de `.github/workflows/ci.yml`; añadir `@aws-sdk/s3-request-presigner` a `apps/api/package.json` (plan, ajustes 2 y 4) — `chore(repo)`
- [X] T003 [P] Alinear `research.md` (R1: cola en `apps/api/src/jobs/detection.ts` con el patrón de `project-deletion.ts`; R5: `DETECTION_LLM_MODEL`, por defecto `claude-opus-5-5`, con salidas estructuradas y `refusal`; R7: capa HTML con `overlay` y hueco `editorPanel`; R9: Railway con una réplica y quizá 0,5 GB, `DETECTION_CONCURRENCY=1`, configuración por `railway environment edit`), `data-model.md` (transiciones aceptadas como `activity.next`; condición de publicación por `registerPublishGuard`), `contracts/detection-job.md` (imagen display, latido del worker) `quickstart.md` (fixtures generadas, `compra-simple.png`, eventos en tiempo real con *polling* de respaldo, comandos de prueba reales) y el propio `plan.md` (Technical Context: memoria del plan de Railway y `DETECTION_CONCURRENCY=1`; árbol de archivos: `jobs/detection.ts`, `publish-guards.ts`, `e2e/flows/detection.spec.ts`, `/health` del worker) con los ajustes 1–13 del plan; `options.languages` igual en el contrato y en `data-model.md` — `docs(specs)`
- [X] T004 [P] Generador reproducible del conjunto de validación en `apps/analytics/tests/fixtures/generate.py` (semilla fija): 20 diagramas digitales en tres estilos (PlantUML, draw.io y StarUML: acción como rectángulo redondeado, decisión como rombo, inicio como círculo relleno, fin como círculo con anillo, flechas con punta y etiquetas en español con tildes, de 5 a 50 actividades), 5 "escaneados" (ruido, desenfoque y rotación de ±2°) y 5 "fotos" (perspectiva, sombra y bajo contraste), cada uno con su *ground truth* JSON (`bbox` normalizada, `type`, `label`, transiciones); los JSON se versionan en `apps/analytics/tests/fixtures/diagrams/` y los PNG (≈ 30 MB por el ruido) se generan al vuelo con `ensure()` (fuente DejaVu en `tests/fixtures/fonts/`); incluye `004.png` (flujo lineal de 5 actividades, US3) — `test(analytics)`
- [ ] T005 [P] Helpers de E2E en `e2e/flows/detection.ts`: subir `compra-simple.png` como borrador sin actividades (reutiliza `openProject` y `uploadDiagram` de `flows/diagrams.ts`), lanzar la detección por la API y esperar a que el job termine (`GET /api/diagram-versions/:id/detections`) — `test(e2e)`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contrato del job en ambos lados, flags, URL firmada, condiciones de publicación,
colecciones y esqueleto del worker

**⚠️ CRITICAL**: ninguna historia puede empezar hasta completar esta fase

- [ ] T006 [P] Pruebas de `packages/shared/src/detection.ts` en `packages/shared/tests/detection.test.ts`: `DetectionJobInput`, `DetectionProgress` (`stage` ∈ download, shapes, ocr, arrows, refine; `pct` 0–100) y `DetectionResult` v1 (`tempId` único, `bbox` normalizada dentro de 0–1, `type`, `label`, `confidence` 0–1, `flags`, transiciones que referencian `tempId` existentes); `confidenceLevel(confidence)` (`high` ≥ 0,8, `medium` ≥ 0,5, `low`); `DetectionJobStatus` (`pending`, `running`, `done`, `failed`) y `ProposalStatus`; `options` con `llmRefine`, `arrows` y `languages`; los ejemplos JSON de `apps/analytics/tests/contract/examples/*.json` validan — `test(shared)`
- [ ] T007 Implementar `packages/shared/src/detection.ts` (esquemas zod, tipos de propuestas y de los eventos `detection.progress`, `detection.completed`, `detection.failed` y `proposal.reviewed`) y exportarlo desde `packages/shared/src/index.ts`; crear los ejemplos de contrato en `apps/analytics/tests/contract/examples/` (entrada, progreso, resultado con y sin transiciones, resultado vacío) — `feat(shared)`
- [ ] T008 [P] Prueba de contrato del lado Python en `apps/analytics/tests/contract/test_detection_job.py`: los mismos ejemplos validan contra los modelos pydantic, un resultado inválido (bbox fuera de 0–1, transición a un `tempId` inexistente, `v` distinto de 1) se rechaza, y el resultado serializado por pydantic valida contra los ejemplos (ida y vuelta) — `test(analytics)`
- [ ] T009 Implementar `apps/analytics/src/analytics/detection/schemas.py` (pydantic, espejo del contrato v1) — `feat(analytics)`
- [ ] T010 [P] Pruebas de los flags en `apps/api/tests/integration/detection-flag.test.ts`: `detection` y `detection-llm` desactivados por defecto y de la 006; sin `detection`, `POST /diagram-versions/:id/detections` y las rutas de propuestas responden `404` (`GATED_PREFIXES`) y `GET /config` lo informa; con `detection=true`, existen — `test(api)`
- [ ] T011 Implementar los flags en `packages/shared/src/flags.ts`, los prefijos en `GATED_PREFIXES` de `apps/api/src/plugins/flags.ts` y `docs/feature-flags.md`; `FEATURE_FLAGS` por defecto `detection=true` en `infra/docker-compose.yml` y en el job `e2e-smoke` de `.github/workflows/ci.yml` — `feat(shared)`
- [ ] T012 [P] Prueba de `presignGet` en `apps/api/tests/integration/storage-presign.test.ts` (RustFS real): la URL descarga el objeto sin credenciales, caduca tras el TTL inyectado y no permite escribir — `test(api)`
- [ ] T013 Implementar `presignGet(key, ttlSeconds)` en `apps/api/src/lib/storage.ts` con `@aws-sdk/s3-request-presigner` (plan, ajuste 4) — `feat(api)`
- [ ] T014 [P] Pruebas del registro de condiciones de publicación en `apps/api/tests/integration/publish-guards.test.ts`: una condición registrada que falla bloquea `POST .../publish` con su `422` y su mensaje sin cambiar la versión; sin condiciones, la publicación de la 003 no cambia (las pruebas de `diagrams-publish` siguen en verde) — `test(api)`
- [ ] T015 Implementar `app.registerPublishGuard(name, guard)` en `apps/api/src/modules/diagrams/publish-guards.ts` (como `dependents.ts`) y llamarlo desde `publish()` en `apps/api/src/modules/diagrams/service.ts` antes de reclamar la versión (plan, ajuste 6) — `feat(api)`
- [ ] T016 [P] Prueba de la migración en `apps/api/tests/integration/detection-migration.test.ts`: `20261022000000-detection-indexes.js` crea `{versionId, createdAt: -1}` y el índice único parcial de jobs `pending|running` por versión en `detection_jobs`, y `{versionId, status}` en `activity_proposals` y `transition_proposals`; `down` los elimina; `up → down → up` es consistente — `test(api)`
- [ ] T017 Implementar la migración `apps/api/migrations/20261022000000-detection-indexes.js` y los modelos `apps/api/src/modules/detection/models/{job,activity-proposal,transition-proposal}.ts` según `data-model.md` — `feat(api)`
- [ ] T018 [P] Pruebas del worker en `apps/analytics/tests/unit/test_worker.py` (Redis real, procesador simulado): consume la cola `detection` con el prefijo `bull`, publica el progreso, devuelve el resultado validado por pydantic, falla con el código en el mensaje (`IMAGE_DOWNLOAD_FAILED`, `TIMEOUT`, `INTERNAL`) escribe el latido `detection:worker:{id}` con TTL de 30 s y expone `GET /health` en `PORT` (`200` con Redis y el bucle vivos, `503` si no; constitución VI); respeta `DETECTION_CONCURRENCY` y `DETECTION_TIMEOUT_S` — `test(analytics)`
- [ ] T019 Implementar `apps/analytics/src/analytics/worker.py` (`python -m analytics.worker`: `bullmq.Worker`, latido, `GET /health` mínimo en `PORT`, cierre ordenado con SIGTERM, logs JSON con `jobId` y `requestId`) y el servicio `analytics-worker` en `infra/docker-compose.yml` (misma imagen, otro comando, sin puerto publicado) — `feat(analytics)`

**Checkpoint**: fundaciones listas; `pnpm test`, `pnpm test:py`, `pnpm e2e` y el despliegue siguen en verde con los flags desactivados

---

## Phase 3: User Story 1 - Propuesta automática de actividades (Priority: P1) 🎯 MVP

**Goal**: el Administrador lanza la detección sobre un borrador, ve el progreso sin quedarse
bloqueado y, al terminar, las zonas propuestas con nombre, tipo y confianza

**Independent Test**: quickstart.md §1 (con `compra-simple.png` y el diagrama de 15 actividades
del conjunto de validación)

### Tests for User Story 1 ⚠️

- [ ] T020 [P] [US1] Pruebas unitarias en `apps/analytics/tests/unit/test_preprocess.py` y `test_shapes.py` con formas dibujadas con OpenCV: escalado a ≤ 3000 px, binarización; rectángulo redondeado → `action`, rombo → `decision`, círculo relleno → `start`, círculo con anillo → `end`; el texto dentro de una forma no se propone como forma; contornos diminutos descartados; confianza geométrica en 0–1 — `test(analytics)`
- [ ] T021 [P] [US1] Pruebas unitarias en `apps/analytics/tests/unit/test_ocr.py`: lee "Validar pago" y "Emitir factura" (con tildes) en zonas renderizadas; une líneas y normaliza espacios; texto ilegible o confianza < 40 → `label` vacío, `empty_label` y confianza baja; no traduce el inglés — `test(analytics)`
- [ ] T022 [P] [US1] Evaluación en `apps/analytics/tests/eval/evaluate_detection.py` y su prueba `apps/analytics/tests/eval/test_gate.py`: empareja por IoU ≥ 0,5 y calcula el recall de zonas y tipos y la exactitud de etiquetas (similitud normalizada ≥ 0,9) por subconjunto; sobre el subconjunto digital, zonas ≥ 0,85 (SC-001) y etiquetas ≥ 0,80 (SC-002); imprime la tabla por diagrama — `test(analytics)`
- [ ] T023 [P] [US1] Pruebas de integración en `apps/api/tests/integration/detection.test.ts` (worker falso en Node): solo el Administrador y solo sobre un borrador (`404` al Participante, `409` sobre una versión publicada o con el proyecto cerrado); un segundo `POST` con un job activo → `409`; el job pasa `pending → running → done` (estados de la constitución VI) y el progreso queda en `detection_jobs`; al completar se guardan las propuestas con su `confidenceLevel` y `possible_duplicate` si se superponen (IoU ≥ 0,5) con actividades existentes; un resultado vacío completa con 0 propuestas; un fallo deja `failed` con un mensaje en español sin detalles internos y se puede reintentar; sin respuesta en el timeout (inyectado), `failed` con `TIMEOUT`; volver a lanzar pasa las propuestas `pending` anteriores a `superseded`; las métricas del job guardan `proposed`, `durationMs` y `llmUsed` (FR-009); se emiten `detection.progress`, `detection.completed` y `detection.failed`; el worker recibe una URL firmada de la imagen display; `GET /health/deep` informa `detection-worker` según el latido — `test(api)`
- [ ] T024 [P] [US1] Pruebas de contrato en `apps/api/tests/contract/detection.contract.test.ts` (respuestas de `detection.openapi.yaml` de iniciar y consultar la detección y listar propuestas) y ampliación de `apps/api/tests/contract/socket-events.contract.test.ts` con `detection.progress`, `detection.completed` y `detection.failed` retransmitidos a `diagram:{versionId}` (constitución III); un Participante en la sala de la versión publicada no los recibe — `test(api)`
- [ ] T025 [P] [US1] Pruebas de web en `apps/web/tests/detection.test.tsx`: *Detectar actividades* solo para el Administrador, en modo edición y con el flag; el progreso por etapa llega por el socket y, sin conexión, por *polling* cada 3 s; se puede seguir navegando; al terminar, `ProposalsLayer` dibuja cada propuesta en coordenadas de imagen con borde discontinuo, icono y texto de confianza (no solo color); sin resultados, "No se encontraron actividades; marca las zonas manualmente"; un fallo muestra el mensaje y *Reintentar* — `test(web)`
- [ ] T026 [P] [US1] E2E en `e2e/flows/detection.spec.ts`: con `compra-simple.png` subido sin actividades, el Administrador pulsa *Detectar actividades*, ve el progreso y, al terminar, al menos 5 de las 6 zonas propuestas con su nombre — `test(e2e)`

### Implementation for User Story 1

- [ ] T027 [US1] Implementar `apps/analytics/src/analytics/detection/{preprocess.py,shapes.py}` (research R3); la confianza es `0,6 × ajuste geométrico + 0,4 × confianza del OCR` (sin texto, solo la geométrica para inicio y fin), con los pesos ajustables según el conjunto de validación — `feat(analytics)`
- [ ] T028 [US1] Implementar `apps/analytics/src/analytics/detection/ocr.py` (research R4) — `feat(analytics)`
- [ ] T029 [US1] Implementar `apps/analytics/src/analytics/detection/pipeline.py` (descarga por la URL firmada, etapas con progreso, ≤ 3000 px) y conectarlo al worker; job `detection-eval` en `.github/workflows/ci.yml` que ejecuta `evaluate_detection.py --subset digital` cuando cambia `apps/analytics/src/analytics/detection/**` o el conjunto de validación — `feat(analytics)`
- [ ] T030 [US1] Implementar `apps/api/src/jobs/detection.ts` (`Queue` y `QueueEvents`, timeout, persistencia validada con zod, duplicados, eventos de dominio y check `detection-worker` en `/health/deep`) y `apps/api/src/modules/detection/{routes.ts,service.ts}` (iniciar, consultar y listar propuestas); retransmitir los eventos `detection.*` a `diagram:{versionId}` en `apps/api/src/realtime/bridge.ts` — `feat(api)`
- [ ] T031 [US1] Implementar `apps/web/src/features/detection/{api.ts,DetectButton.tsx,DetectionProgress.tsx,ProposalsLayer.tsx}` y el hueco `editorPanel` de `apps/web/src/features/diagrams/workspace/WorkspacePage.tsx`; la capa usa la prop `overlay` (plan, ajuste 8) — `feat(web)`

**Checkpoint**: US1 funcional; quickstart §1 en verde

---

## Phase 4: User Story 2 - Revisar y confirmar las propuestas (Priority: P1)

**Goal**: el Administrador acepta, corrige o descarta cada propuesta, acepta en bloque las de
confianza alta y no puede publicar con propuestas pendientes

**Independent Test**: quickstart.md §2

### Tests for User Story 2 ⚠️

- [ ] T032 [P] [US2] Pruebas de integración en `apps/api/tests/integration/proposals.test.ts`: aceptar crea una actividad normal con `source: 'detected'` y `key` nueva por el servicio de actividades de la 003 (con las correcciones de nombre, tipo o zona si las hay); descartar no la crea; aceptar dos veces → `409`; aceptar una propuesta con `label` vacío sin corregirlo → `422`; *aceptar las de confianza alta* acepta solo `high` sin `possible_duplicate` y deja el resto pendiente; las métricas `accepted`, `edited` y `discarded` del job se actualizan (FR-009); con propuestas pendientes, publicar → `422 PENDING_PROPOSALS` con el conteo y, tras revisarlas, publica; el Participante → `404`; con el proyecto cerrado → `409`; volver a detectar no modifica las actividades ya aceptadas; se emite `proposal.reviewed` — `test(api)`
- [ ] T033 [P] [US2] Ampliar `apps/api/tests/contract/detection.contract.test.ts` con aceptar, descartar y aceptar en bloque, y `socket-events.contract.test.ts` con `proposal.reviewed` — `test(api)`
- [ ] T034 [P] [US2] Pruebas de web en `apps/web/tests/proposal-review.test.tsx`: el panel lista las pendientes con su confianza; editar nombre, tipo y zona antes de aceptar; una propuesta sin nombre pide escribirlo antes de aceptar; descartar; *Aceptar todas las de confianza alta* indica cuántas acepta y excluye los posibles duplicados (con su aviso); la actividad aceptada aparece en el editor y la propuesta desaparece de la capa; publicar con pendientes muestra el conteo; `proposal.reviewed` de otra pestaña actualiza la lista — `test(web)`
- [ ] T035 [P] [US2] Ampliar `e2e/flows/detection.spec.ts`: aceptar las de confianza alta, corregir y aceptar una, descartar otra, intentar publicar con pendientes (bloqueado con el conteo), revisar el resto y publicar; volver a detectar sobre el borrador nuevo marca los posibles duplicados — `test(e2e)`

### Implementation for User Story 2

- [ ] T036 [US2] Implementar en `apps/api/src/modules/detection/{routes.ts,service.ts}` aceptar, descartar y aceptar en bloque, las métricas, `proposal.reviewed` y la condición de publicación registrada con `registerPublishGuard` (FR-007) — `feat(api)`
- [ ] T037 [US2] Implementar `apps/web/src/features/detection/ProposalReviewPanel.tsx` en el hueco `editorPanel`, con la edición de la zona sobre la capa de propuestas y la actualización de la caché por `proposal.reviewed` — `feat(web)`

**Checkpoint**: US1 + US2 funcionales; quickstart §1–§2 en verde

---

## Phase 5: User Story 3 - Propuesta de transiciones (Priority: P3)

**Goal**: se proponen las flechas entre actividades y el Administrador las revisa igual que las
actividades

**Independent Test**: quickstart.md §3 (`004.png`, flujo lineal de 5 actividades)

### Tests for User Story 3 ⚠️

- [ ] T038 [P] [US3] Pruebas unitarias en `apps/analytics/tests/unit/test_arrows.py`: en `004.png` se proponen las 4 transiciones en orden; la dirección sale de la punta; segmentos colineales se unen; una línea sin punta no se propone; la confianza baja con puntas borrosas; el recall de transiciones del subconjunto digital se informa en `evaluate_detection.py` (sin gate) — `test(analytics)`
- [ ] T039 [P] [US3] Pruebas de integración en `apps/api/tests/integration/transition-proposals.test.ts`: aceptar exige que las dos propuestas estén aceptadas (`422` si no, como el contrato) y añade la `key` destino al `next` de la actividad origen; descartar no la añade; volver a detectar las pasa a `superseded`; cuentan en `PENDING_PROPOSALS`; contrato ampliado en `detection.contract.test.ts` — `test(api)`
- [ ] T040 [P] [US3] Pruebas de web en `apps/web/tests/transition-proposals.test.tsx`: las transiciones propuestas se dibujan discontinuas en la capa; aceptar y descartar desde el panel; aceptar queda deshabilitado mientras alguna de sus actividades siga pendiente — `test(web)`

### Implementation for User Story 3

- [ ] T041 [US3] Implementar `apps/analytics/src/analytics/detection/arrows.py` (research R6) e incorporarlo al pipeline (etapa `arrows`) — `feat(analytics)`
- [ ] T042 [US3] Implementar en `apps/api/src/modules/detection/` aceptar y descartar transiciones (por el servicio de actividades de la 003) — `feat(api)`
- [ ] T043 [US3] Implementar las transiciones propuestas en `ProposalsLayer.tsx` y `ProposalReviewPanel.tsx` — `feat(web)`

**Checkpoint**: todas las historias funcionales; quickstart §1–§3 en verde

---

## Phase 6: Refinamiento opcional con Claude (US1, flag `detection-llm`)

**Goal**: mejorar los nombres leídos (SC-002) sin depender del modelo para funcionar

- [ ] T044 [P] [US1] Pruebas en `apps/analytics/tests/unit/test_llm_refine.py` con un cliente de Anthropic simulado: se envía solo la imagen y las zonas (sin datos de usuarios) y se pide salida estructurada con el esquema de correcciones; una corrección sustituye `label` y `type` solo con IoU ≥ 0,7 (`llm_corrected`); las zonas nuevas entran con confianza `medium` y `llm_added`; con `stop_reason` `refusal`, error de la API o más de 30 s, se devuelve el resultado local sin fallar el job; conserva el idioma del diagrama (pide no traducir y una corrección traducida se descarta); sin `ANTHROPIC_API_KEY` o con `detection-llm` desactivado no se llama; `stats.llmUsed` lo refleja — `test(analytics)`
- [ ] T045 [US1] Implementar `apps/analytics/src/analytics/detection/llm_refine.py` con el SDK `anthropic` (`DETECTION_LLM_MODEL`, por defecto `claude-opus-5-5`; plan, ajuste 11), etapa `refine` del pipeline y la opción `llmRefine` del job según el flag — `feat(analytics)`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T046 [P] Mediciones en `e2e/perf/detection.perf.spec.ts` y en `evaluate_detection.py --timing`: detección de un diagrama de 50 actividades del conjunto de validación en < 60 s (SC-003) en Compose, memoria máxima del worker < 400 MB (plan, ajuste 9) y el resultado del gate de precisión; anotarlo en `plan.md` — `perf(e2e)`
- [ ] T047 [P] Completar el ADR 0008 con las mediciones de T046 y el resultado del gate de precisión — `docs(adr)`
- [ ] T048 [P] README (sección de detección asistida: flujo, flags `detection` y `detection-llm`, `analytics-worker` en Compose, `pnpm test:py` y la evaluación) y revisar que `quickstart.md` siga al día — `docs(repo)`
- [ ] T049 Desplegar `analytics-worker`: añadirlo al bucle de `scripts/railway/deploy-service.sh` en `.github/workflows/deploy.yml` (y a `scripts/rollback.sh`), su configuración en `apps/analytics/railway.worker.json` (fuente de verdad; Railway no la lee y se aplica con `railway environment edit`, ADR 0002), y registrarlo en `docs/adr/0002-despliegue-railway.md` — `ci(deploy)`
- [ ] T050 Configurar Railway **antes de fusionar** (lo hace el propietario): crear el servicio `analytics-worker` en staging y producción con la imagen de `analytics`, *start command* `python -m analytics.worker`, healthcheck `GET /health` y reinicio `ON_FAILURE` (aplicado con `railway environment edit`); variables `REDIS_URL`, `DETECTION_CONCURRENCY=1` y `DETECTION_TIMEOUT_S=180`; `ANTHROPIC_API_KEY` solo si se quiere el refinamiento; `FEATURE_FLAGS=detection=true` en `api` de staging (producción sin cambios) — `docs(infra)`
- [ ] T051 Recorrer quickstart.md en staging (§1–§3), comprobar memoria y tiempo del worker con el plan de la cuenta y cronometrar SC-004 (diagrama de 20 actividades con y sin detección); registrar el resultado en `quickstart.md` — `docs(repo)`
- [ ] T052 Activar `detection` por defecto (`default: true`) cuando las tres historias y T051 estén en verde y retirarlo en un commit posterior y separado (constitución IV); `detection-llm` sigue como flag operativo (coste) con `default: false` — `feat(shared)`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → historias.
- **US1**: tras la Phase 2. Aporta la cola, el worker con el pipeline y la capa de propuestas.
- **US2**: tras US1 (revisa lo que propone US1).
- **US3**: tras US2 (aceptar una transición exige actividades aceptadas).
- **Refinamiento (Phase 6)**: tras US1; independiente de US2 y US3.
- **Polish**: al final; T050 antes de fusionar a `main`. T052 es la última tarea.

### Within Each User Story

- Pruebas (en rojo) → implementación (en verde) → refactor; cada par se integra en un commit.
- `analytics` (pipeline) y `api` (cola y servicio) en paralelo → `web` → E2E en verde.

### Parallel Opportunities

- Phase 1: T001 primero; T003, T004 y T005 en paralelo con T002.
- Phase 2: los pares T006–T007, T010–T011, T012–T013, T014–T015 y T016–T017 son independientes entre sí; T008–T009 tras T007; T018–T019 tras T009.
- US1: T020–T026 a la vez; luego `analytics` (T027–T029) y `api` (T030) en paralelo, y `web` (T031) tras T030.
- Phase 6 en paralelo con US2 y US3 (solo toca `analytics`).

## Parallel Example: User Story 1

```bash
# Pruebas en paralelo (deben fallar):
Task: "Formas en apps/analytics/tests/unit/test_shapes.py"
Task: "OCR en apps/analytics/tests/unit/test_ocr.py"
Task: "Gate de precisión en apps/analytics/tests/eval/test_gate.py"
Task: "Ciclo del job en apps/api/tests/integration/detection.test.ts"
Task: "Contrato en apps/api/tests/contract/detection.contract.test.ts"
Task: "Web en apps/web/tests/detection.test.tsx"
Task: "E2E en e2e/flows/detection.spec.ts"
```

## Implementation Strategy

### MVP First

1. Phases 1 y 2 → 2. US1 → **validar con quickstart §1** (propuestas con nombre, tipo y
   confianza sobre `compra-simple.png`; gate de precisión en verde).

### Incremental Delivery

US2 → US3 → refinamiento, cada una integrable en `main` detrás del flag `detection` y desplegable
en staging (con `detection=true` solo allí). Producción recibe el código en cada release, pero la
funcionalidad solo se activa con T052.

## Notes

- Tareas totales: 52 (Setup 5, Foundational 14, US1 12, US2 6, US3 6, refinamiento 2, Polish 7).
- Nunca integrar un commit que rompa `pnpm test` o `pnpm test:py` (Principio IV).
- T050 requiere acceso a Railway y lo hace el propietario del proyecto; T051 usa staging.
- El worker nunca escribe en MongoDB: devuelve el resultado y `api` lo persiste (Principio II).
- Ninguna propuesta se convierte en actividad sin aceptación explícita (Principio VII).
- Cambios tras `/speckit-analyze`: C1 → plan ajuste 10, T018, T019, T050; C2 → plan ajuste 12, data-model, contrato, T006, T016, T023; C3 → T001 (ADR antes de las dependencias) y T047; I1 → T039; I2 e I3 → T003, T006; G1 → T032, T034; G2 → T023; A1 → T027; U1 → T044.
