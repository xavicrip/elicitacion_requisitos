# Implementation Plan: Diagramas de actividades y espacio de trabajo interactivo

**Branch**: `003-diagramas-canvas` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-diagramas-canvas/spec.md`

## Summary

El Administrador sube una imagen (PNG/JPG/SVG ≤ 10 MB). La API valida el tipo real del
archivo, rasteriza los SVG (eliminando así cualquier script) y genera con `sharp` una versión
de visualización (≤ 8192 px por lado) y una miniatura para el minimapa, que se guardan en un
bucket compatible con S3. El canvas se construye con **three.js** vía `@react-three/fiber`:
cámara ortográfica, plano texturizado con el diagrama, zonas de actividad como meshes con
raycasting, `MapControls` con zoom al cursor, minimapa HTML y un editor de rectángulos con
guardado automático y control de concurrencia optimista. Las actividades usan coordenadas
normalizadas (0–1) y una `key` estable entre versiones del diagrama, lo que permite que los
requisitos de la feature 004 sobrevivan a nuevas versiones.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 24 LTS
**Primary Dependencies**: `api`: `@fastify/multipart`, `file-type`, `sharp`, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. `web`: `three`, `@react-three/fiber` 9, `@react-three/drei` 10 (`MapControls`, `Text`, `Html`), Zustand
**Storage**: MongoDB (`diagrams`, `diagram_versions`, `activities`); bucket S3 (Railway Bucket; MinIO en local) con claves `projects/{projectId}/diagrams/{versionId}/{original|display|thumb}.{ext}`
**Testing**: Vitest (API: contrato, integración con MinIO en CI; web: lógica de cámara y coordenadas con pruebas unitarias puras), Playwright (subida, edición, publicación, navegación, teclado; capturas visuales del canvas con `toHaveScreenshot`)
**Target Platform**: navegadores con WebGL 2 (escritorio y tablet para editar; móvil en solo lectura)
**Project Type**: Aplicación web
**Performance Goals**: ≥ 50 FPS con 100 actividades (RNF-01); diagrama navegable en < 3 s con 10 Mbps (SC-003); procesamiento de imagen < 5 s para 10 MB
**Constraints**: textura ≤ 8192 px (límite habitual de WebGL en GPU integradas); presigned URLs de 1 h; solo Admin edita; proyecto `closed` en solo lectura
**Scale/Scope**: ≤ 20 diagramas por proyecto, ≤ 100 actividades por versión

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento | Estado |
|-----------|--------------|--------|
| I. Requisito anclado a la actividad | Las actividades tienen una `key` estable entre versiones; es el ancla que usará la 004. Eliminar una actividad con requisitos exige confirmación (US2-5). | ✅ |
| II. Servicios desacoplados | Colecciones propiedad de `api`; esquemas en `packages/shared/src/diagrams.ts`; `analytics` accederá a las imágenes solo mediante presigned URLs (006). | ✅ |
| III. Pruebas primero | Contratos, matriz de autorización ampliada, pruebas puras de transformación de coordenadas y E2E del editor antes de implementar. | ✅ |
| IV. Commits atómicos y reversibles | Migración `up/down` de índices; el editor se integra detrás del flag `diagram-editor` hasta completar la US3. | ✅ |
| V. Seguridad por defecto | Validación por *magic bytes*, rasterización de SVG, límite de 10 MB en el stream, bucket privado con presigned URLs, verificación de rol en el servidor. | ✅ |
| VI. Observabilidad | Log de subida y procesamiento (tamaño, dimensiones, duración) con `requestId`. | ✅ |
| VII. Simplicidad | Zonas solo rectangulares; minimapa en HTML/CSS sobre la miniatura (sin segundo canvas WebGL); sin tiles de imagen. | ✅ |
| Restricciones (v1.1.0) | Node 24; three.js; despliegue desde GitHub Actions (nuevas variables `S3_*`). | ✅ |

**Re-evaluación post-diseño**: sin violaciones.

## Project Structure

### Documentation (this feature)

```text
specs/003-diagramas-canvas/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── diagrams.openapi.yaml
│   └── canvas-ui.md          # Contrato de interacción del canvas (atajos, estados, eventos)
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/diagrams.ts          # Diagram, DiagramVersion, Activity, BBox (0–1), ActivityType
apps/api/src/
├── lib/storage.ts                        # Cliente S3 + presigned URLs
├── lib/image-pipeline.ts                 # file-type → sharp (rasterizar, display, thumb)
└── modules/diagrams/
    ├── routes.ts                         # diagramas, versiones, subida, publicación
    ├── activities.routes.ts              # CRUD de actividades con If-Match
    ├── service.ts
    ├── models/{diagram,version,activity}.ts
    └── cascade.ts                        # registerProjectCascade: borra documentos y objetos S3
apps/api/migrations/20261008000000-diagrams-indexes.js
apps/web/src/features/diagrams/
├── DiagramListPage.tsx, UploadDialog.tsx
├── workspace/
│   ├── WorkspacePage.tsx                 # layout: canvas + barra de herramientas + panel lateral
│   ├── DiagramCanvas.tsx                 # <Canvas orthographic> + plano texturizado
│   ├── camera/{useFitToScreen.ts,zoom.ts}# lógica pura testeable
│   ├── ActivityHotspots.tsx              # meshes, hover, selección
│   ├── Minimap.tsx                       # miniatura + rectángulo del viewport
│   ├── A11yActivityList.tsx              # lista accesible sincronizada con el canvas
│   └── store.ts                          # Zustand: selección, modo, zoom
└── editor/
    ├── EditorLayer.tsx                   # dibujar, mover, redimensionar (handles)
    ├── ActivityForm.tsx                  # nombre, tipo, transiciones
    ├── TransitionArrows.tsx
    └── useAutosave.ts                    # debounce 500 ms + If-Match + manejo de 409
infra/docker-compose.yml                  # + servicio minio y bucket inicial
e2e/{diagram-upload,diagram-editor,workspace-navigation}.spec.ts
```

**Structure Decision**: nuevo módulo `diagrams` en `api` con el patrón de la 002; en `web`, la
feature `diagrams` se divide en `workspace/` (visualización, reutilizada por 004–006) y
`editor/` (solo Admin).

## Complexity Tracking

Sin violaciones.
