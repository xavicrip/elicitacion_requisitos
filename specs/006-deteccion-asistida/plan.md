# Implementation Plan: Detección asistida de actividades en la imagen

**Branch**: `006-deteccion-asistida` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-deteccion-asistida/spec.md`

## Summary

El Administrador pulsa "Detectar actividades" sobre una versión en borrador. La `api` crea un
`detection_job` y lo encola en **BullMQ** (cola `detection`). Un **worker Python** del servicio
`analytics` descarga la imagen mediante una presigned URL y ejecuta un pipeline **OpenCV**
(binarización, contornos y clasificación de formas UML: rectángulo redondeado, rombo, círculo
lleno, círculo con anillo), **OCR con Tesseract** (`spa+eng`) sobre cada zona y, de forma
opcional, un paso de refinamiento con un **modelo multimodal (Claude)** que corrige etiquetas
y tipos. También detecta flechas con Hough para proponer transiciones (P3). El resultado vuelve
como valor de retorno del job; la `api` lo persiste como **propuestas** (`activity_proposals`,
`transition_proposals`) que el Administrador acepta, corrige o descarta en el editor de la 003.
Nada se convierte en actividad sin aceptación explícita (Principio VII).

## Technical Context

**Language/Version**: Python 3.12 (`analytics`), TypeScript 5.x / Node.js 24 LTS (`api`, `web`)
**Primary Dependencies**: `analytics`: `bullmq` (worker Python oficial), `opencv-python-headless`, `numpy`, `pytesseract` + paquetes del sistema `tesseract-ocr`, `tesseract-ocr-spa`, `tesseract-ocr-eng`, `httpx`, `anthropic` (opcional, flag `detection-llm`). `api`: `bullmq` (Queue + QueueEvents). `web`: capa de propuestas en el editor
**Storage**: MongoDB (`detection_jobs`, `activity_proposals`, `transition_proposals`, propiedad de `api`); Redis (colas BullMQ); lectura de imágenes del bucket vía presigned URL
**Testing**: pytest con un **conjunto de validación etiquetado** (30 diagramas con *ground truth* JSON) y un script de precisión y exhaustividad con umbrales como gate de CI; Vitest (endpoints de la API y ciclo de vida del job con un worker falso); Playwright (flujo de revisión)
**Target Platform**: `analytics` en Railway (contenedor con Tesseract, 2 GB de RAM)
**Project Type**: Aplicación web + servicio de procesamiento
**Performance Goals**: < 60 s para 50 actividades (SC-003); tiempo máximo del job 3 min (edge case)
**Constraints**: el worker no escribe en MongoDB (devuelve el resultado a la API); la imagen solo llega por presigned URL; sin datos personales hacia el LLM (solo la imagen del diagrama)
**Scale/Scope**: diagramas de hasta 8192 px y 100 actividades; ≤ 2 jobs concurrentes por réplica

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento | Estado |
|-----------|--------------|--------|
| I. Requisito anclado a la actividad | Las propuestas aceptadas se convierten en actividades normales (`source: detected`) con `key` estable. | ✅ |
| II. Servicios desacoplados | Contrato de job en `contracts/detection-job.md` (entrada y salida versionadas); `analytics` no escribe en colecciones de `api`; la imagen se pasa por URL firmada. | ✅ |
| III. Pruebas primero | Pruebas unitarias por etapa del pipeline, prueba de contrato del job en ambos lados y gate de precisión sobre el conjunto de validación antes de implementar cada etapa. | ✅ |
| IV. Commits atómicos y reversibles | Flags `detection` (toda la feature) y `detection-llm` (refinamiento); migración de índices con `down`. | ✅ |
| V. Seguridad por defecto | Presigned URL de 10 min; `ANTHROPIC_API_KEY` solo en Railway; validación del resultado con esquema (pydantic en la salida y zod en la entrada de `api`). | ✅ |
| VI. Observabilidad | Estado y progreso del job consultables; métricas por detección (FR-009); logs con `jobId` y `requestId`. | ✅ |
| VII. Humano en el bucle | Propuestas con confianza; aceptación explícita, individual o en bloque (solo las de confianza alta y sin superposición); publicar exige 0 propuestas pendientes. | ✅ |
| Restricciones (v1.1.0) | Python 3.12 + FastAPI/worker en `analytics`; despliegue desde GitHub Actions (la imagen de `analytics` incluye Tesseract). | ✅ |

**Re-evaluación post-diseño**: sin violaciones.

## Project Structure

### Documentation (this feature)

```text
specs/006-deteccion-asistida/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── detection-job.md          # Contrato de la cola (entrada/salida/progreso)
│   └── detection.openapi.yaml    # Endpoints REST de api
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/detection.ts                    # DetectionJobInput/Result (zod), ProposalStatus
apps/analytics/src/analytics/
├── worker.py                                       # Worker BullMQ ("detection"), progreso, timeouts
└── detection/
    ├── pipeline.py                                 # Orquesta las etapas → DetectionResult
    ├── preprocess.py                               # escala de grises, binarización adaptativa
    ├── shapes.py                                   # contornos → action/decision/start/end + confianza
    ├── ocr.py                                      # Tesseract por zona (spa+eng), limpieza de texto
    ├── arrows.py                                   # HoughLinesP + puntas → transiciones
    ├── llm_refine.py                               # Refinamiento opcional con Claude (flag)
    └── schemas.py                                  # pydantic (espejo del contrato)
apps/analytics/tests/
├── fixtures/diagrams/{001..030}.{png,json}         # Conjunto de validación con ground truth
├── unit/test_{shapes,ocr,arrows,preprocess}.py
├── contract/test_detection_job.py
└── eval/evaluate_detection.py                      # precisión/exhaustividad → gate de CI
apps/api/src/modules/detection/
├── routes.ts                                       # iniciar, estado, propuestas, aceptar/descartar
├── queue.ts                                        # Queue + QueueEvents → persistir resultado
├── service.ts                                      # aceptar → crear activity (source: detected)
└── models/{job,activity-proposal,transition-proposal}.ts
apps/api/migrations/20261022000000-detection-indexes.js
apps/web/src/features/detection/
├── DetectButton.tsx, DetectionProgress.tsx
├── ProposalsLayer.tsx                              # zonas punteadas con color por confianza
└── ProposalReviewPanel.tsx                         # aceptar / editar / descartar / aceptar todas (alta)
.github/workflows/ci.yml                            # + job detection-eval
e2e/detection-review.spec.ts
```

**Structure Decision**: el pipeline vive en `analytics` como paquete `detection/` con etapas
puras testeables; el worker es un segundo proceso del mismo servicio (`analytics-worker` en
Railway, misma imagen con otro *start command*), de modo que la API FastAPI y el worker escalan
por separado.

## Ajustes tras implementar la 002, la 003, la 004 y la 005 (2026-10-02)

1. **BullMQ real**: `api` ya usa `bullmq` 6 (`apps/api/src/jobs/project-deletion.ts`: `Queue` y
   `Worker` con una conexión `ioredis` propia y `queuePrefix` para aislar las pruebas). La cola
   `detection` sigue el mismo patrón (`apps/api/src/jobs/detection.ts` en lugar de
   `modules/detection/queue.ts`), con `QueueEvents` para `progress`, `completed` y `failed`. El
   worker de Python usa el paquete `bullmq` con el mismo prefijo (`bull`) y la misma URL de Redis;
   la prueba de contrato del job se ejecuta en ambos lados contra el mismo JSON de ejemplo.
2. **`analytics` actual**: FastAPI con `pydantic-settings`, `redis` y `pymongo`, gestionado con
   `uv`, imagen `python:3.12-slim-bookworm` con usuario sin privilegios. Se añaden
   `opencv-python-headless`, `numpy`, `pytesseract`, `bullmq` y (opcional) `anthropic`, y el
   `Dockerfile` instala `tesseract-ocr`, `tesseract-ocr-spa` y `tesseract-ocr-eng` en la etapa
   `runtime`. El worker es `python -m analytics.worker` en la misma imagen.
3. **Flags**: el registro está vacío salvo `invite-email`. Se añaden `detection`
   (`default: false`) y `detection-llm` (`default: false`), owner `006-deteccion-asistida`. Las
   rutas nuevas (`/diagram-versions/:id/detection`, `/proposals/...`) se ocultan con
   `GATED_PREFIXES` (`apps/api/src/plugins/flags.ts`, hoy vacío) y la web oculta el botón con
   `useFlags`. Se activan por defecto al cerrar la feature y se retiran después, como los de la
   002–005.
4. **Acceso a la imagen**: `createStorage` (`apps/api/src/lib/storage.ts`) solo tiene `put` y
   `getStream`; se añade `presignGet(key, ttlSeconds)` con `@aws-sdk/s3-request-presigner` (10
   min). Se usa la imagen **display** de la versión (la que ya ve el canvas; las `bbox` están
   normalizadas, así que no hace falta la original). En Compose, el worker resuelve
   `http://rustfs:9000` en la misma red; en Railway, el endpoint del bucket es público.
5. **Actividades y transiciones de la 003**: `activities.source` ya admite `'detected'` y la `key`
   se genera al crear; aceptar una propuesta reutiliza el servicio de actividades del editor
   (`activities.service.ts`), no inserta directamente. Las transiciones de la 003 son
   `activity.next` (lista de `key`): aceptar una `transition_proposal` añade la `key` destino al
   `next` de la actividad origen; exige que las dos propuestas estén aceptadas.
6. **Publicación sin acoplar**: `publish()` (`modules/diagrams/service.ts`) solo comprueba que
   haya actividades. En lugar de importar la detección en el módulo de diagramas, se añade un
   registro de condiciones de publicación (`app.registerPublishGuard(name, guard)`), igual que
   `registerActivityDependents`; la detección registra la suya y la publicación responde `422
   PENDING_PROPOSALS` con el conteo.
7. **Progreso en tiempo real (005)**: la detección emite eventos de dominio en `app.domainEvents`
   (`detection.progress`, `detection.completed`, `detection.failed`, con `jobId`, `versionId`,
   `stage` y `pct`), y el puente de la 005 los retransmite a `diagram:{versionId}`, sala a la que
   solo se une quien puede ver el borrador (el Administrador). Sin socket conectado, la web
   consulta `GET /detection-jobs/:id` cada 3 s. Los eventos nuevos se añaden a
   `RELAYED_EVENTS` con su prueba de contrato (constitución III). Si otra pestaña del
   Administrador acepta propuestas, `proposal.reviewed` actualiza la caché igual que los
   detalles de la 004.
8. **Revisión en el editor de la 003**: el editor no tiene puntos de extensión. Las propuestas
   se dibujan como capa HTML sobre el canvas con la prop `overlay` de `WorkspacePage` (la que usan
   los cursores de la 005, colocada con `imageToScreen`), con borde discontinuo, icono y texto por
   confianza; `WorkspacePage` añade un hueco `editorPanel` para el panel de revisión junto a
   `EditorPanel`. Las propuestas no entran en `ActivityHotspots` hasta aceptarse.
9. **Railway**: el plan de la cuenta solo admite una réplica por servicio y, si es Free, 0,5 GB
   de RAM y 1 vCPU (ADR 0002). `analytics-worker` es un servicio aparte (la detección no debe
   bloquear el `/health` de `analytics`) con `DETECTION_CONCURRENCY=1` por defecto; la imagen se
   reduce a ≤ 3000 px antes del pipeline y la prueba de rendimiento mide la memoria máxima del
   worker (objetivo < 400 MB). Railway no lee los `railway.json` (ADR 0002): la configuración del
   servicio nuevo la crea el propietario y se aplica con `railway environment edit`;
   `deploy.yml` añade el servicio al bucle de `scripts/railway/deploy-service.sh`.
10. **Salud del worker**: sin servidor HTTP, el worker escribe un latido en Redis cada 10 s
    (`detection:worker:{id}`, TTL 30 s) y `api /health/deep` añade el check `detection-worker`
    cuando el flag `detection` está activo (constitución VI).
11. **Refinamiento con Claude (opcional)**: el modelo se configura con `DETECTION_LLM_MODEL`
    (por defecto `claude-opus-5-5`; `claude-sonnet-5-5` es la alternativa más barata, a decidir
    al medir), con el SDK `anthropic` de Python, salidas estructuradas (`output_config.format`
    con el esquema de correcciones), comprobación de `stop_reason` (`refusal`) y timeout de 30 s;
    si falla, se sigue con el resultado local. Sin `ANTHROPIC_API_KEY` o con `detection-llm`
    desactivado, no se llama. El coste por detección se registra en `metrics`.
12. **Pruebas**: integración de `api` con un worker falso en Node que consume la cola
    `detection` y devuelve un `DetectionResult` fijo; pytest del pipeline con el conjunto de
    validación; E2E en `e2e/flows/detection.spec.ts` contra Compose con el worker real
    (servicio `analytics-worker` en `infra/docker-compose.yml`) y `compra-simple.png`, que ya
    tiene su *ground truth* (`e2e/fixtures/diagrams/compra-simple.json`).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Servicio adicional en Railway (`analytics-worker`) | La detección es intensiva en CPU (OCR) y no debe bloquear el `/health` ni las peticiones de `analytics` | Ejecutar el worker en el mismo proceso que FastAPI degrada la latencia y hace fallar el healthcheck durante jobs largos |
