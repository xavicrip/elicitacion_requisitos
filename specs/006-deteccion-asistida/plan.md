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

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Servicio adicional en Railway (`analytics-worker`) | La detección es intensiva en CPU (OCR) y no debe bloquear el `/health` ni las peticiones de `analytics` | Ejecutar el worker en el mismo proceso que FastAPI degrada la latencia y hace fallar el healthcheck durante jobs largos |
