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
**Storage**: MongoDB (`diagrams`, `diagram_versions`, `activities`); bucket S3 (Railway Bucket; RustFS en local y CI, ajuste 2) con claves `projects/{projectId}/diagrams/{versionId}/{original|display|thumb}.{ext}`
**Testing**: Vitest (API: contrato, integración con RustFS en CI; web: lógica de cámara y coordenadas con pruebas unitarias puras), Playwright (subida, edición, publicación, navegación, teclado; estado del canvas expuesto en `window.__canvasState`, sin capturas (ajuste 8))
**Target Platform**: navegadores con WebGL 2 (escritorio y tablet para editar; móvil en solo lectura)
**Project Type**: Aplicación web
**Performance Goals**: ≥ 50 FPS con 100 actividades (RNF-01); diagrama navegable en < 3 s con 10 Mbps (SC-003); procesamiento de imagen < 5 s para 10 MB
**Constraints**: textura ≤ 8192 px (límite habitual de WebGL en GPU integradas); imágenes servidas por `api` con el mismo origen (ajuste 1); solo Admin edita; proyecto `closed` en solo lectura
**Scale/Scope**: ≤ 20 diagramas por proyecto, ≤ 100 actividades por versión

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento | Estado |
|-----------|--------------|--------|
| I. Requisito anclado a la actividad | Las actividades tienen una `key` estable entre versiones; es el ancla que usará la 004. Eliminar una actividad con requisitos exige confirmación (US2-5). | ✅ |
| II. Servicios desacoplados | Colecciones propiedad de `api`; esquemas en `packages/shared/src/diagrams.ts`; `analytics` accederá a las imágenes solo mediante presigned URLs (006). | ✅ |
| III. Pruebas primero | Contratos, matriz de autorización ampliada, pruebas puras de transformación de coordenadas y E2E del editor antes de implementar. | ✅ |
| IV. Commits atómicos y reversibles | Migración `up/down` de índices; toda la feature se integra detrás del flag `diagrams` (ajuste 4). | ✅ |
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
infra/docker-compose.yml                  # + servicio s3 (RustFS) y S3_CREATE_BUCKET (ajuste 2)
e2e/flows/{diagram-upload,diagram-editor,workspace-navigation}.spec.ts
```

**Structure Decision**: nuevo módulo `diagrams` en `api` con el patrón de la 002; en `web`, la
feature `diagrams` se divide en `workspace/` (visualización, reutilizada por 004–006) y
`editor/` (solo Admin).

## Ajustes tras implementar la 001 y la 002 (2026-09-30)

El plan se escribió antes de implementar la 001 y la 002. Revisado contra `main` (0.3.0):

1. **Imágenes servidas por `api`, no con URLs prefirmadas.** Railway Buckets admite URLs
   prefirmadas, pero no documenta CORS ni buckets públicos, y WebGL necesita CORS para usar una
   imagen de otro origen como textura. `api` sirve `GET /diagram-versions/:vid/image/
   {display|thumb}` (rutas por recurso, como el resto del contrato) leyendo el objeto del bucket en streaming, con la membresía comprobada
   en cada petición (`requireResourceProject`), `ETag` y `Cache-Control: private, max-age=31536000, immutable`
   (la clave incluye el `versionId`, así que el contenido de una URL nunca cambia). `web` las
   carga por el proxy `/api` (mismo origen, ADR 0004). Coste: el tráfico de las imágenes pasa a
   ser egress del servicio `api` (el del bucket es gratuito); la caché del navegador lo limita a
   una descarga por versión. `analytics` (006) sí podrá usar URLs prefirmadas: es tráfico de
   servidor a servidor, sin CORS.
2. **RustFS en lugar de MinIO** (MinIO ya no publica imágenes; ADR 0003). En CI ya existe el
   servicio `s3` del job `test-node` e `infra/docker-compose.test.yml`; se añade también a
   `infra/docker-compose.yml`. RustFS no crea buckets solo: con `S3_CREATE_BUCKET=true` (solo
   local y CI), `api` lo crea al arrancar si no existe.
3. **Mismo bucket que los respaldos, otro prefijo.** `projects/{projectId}/diagrams/…` junto a
   `mongo-backups/` en el bucket de cada entorno (`reqcanvas`, `reqcanvas-staging`). Variables
   nuevas `S3_*` de `api` como **referencias** al bucket (`${{<bucket>.ENDPOINT}}`…, ADR 0003);
   `BACKUP_S3_*` no cambian. Restaurar un respaldo de MongoDB no toca los objetos del bucket.
4. **Todo detrás de un flag `diagrams`** (constitución IV, como `accounts` en la 002), no solo el
   editor: la subida y el espacio de trabajo también se integran por historias. Sustituye a
   `diagram-editor`.
5. **Proyecto cerrado en solo lectura, borrador editable**: `requireProjectStatus` acepta una
   lista de estados (`['draft', 'open']` para las escrituras de diagramas y actividades). La 004
   y la 005 siguen usando `'open'`.
6. **Cascada** con `app.registerProjectCascade('diagrams', …)` (002): borra documentos y los
   objetos bajo `projects/{projectId}/`, de forma idempotente.
7. **Migración** `20261008000000-diagrams-indexes.js` con `destructive = false`; su `down`
   elimina índices y conserva los datos (como la de la 002).
8. **E2E sin capturas de pantalla del canvas.** `toHaveScreenshot` de WebGL no es portable: en
   local renderiza la GPU del equipo y en CI SwiftShader, así que las referencias no coinciden.
   El canvas expone su estado (cámara, zoom, selección, modo) en `window.__canvasState` solo si
   `import.meta.env.MODE !== 'production'`, y los E2E de `flows` lo comprueban. La lógica de
   cámara y coordenadas se cubre con pruebas unitarias puras.
9. **Subidas de 10 MB por el proxy**: Caddy no limita el cuerpo; `@fastify/multipart` corta el
   stream a 10 MB (`413`). Verificar en staging que el borde de Railway acepta 10 MB.
10. **`sharp` en la imagen de `api`**: comprobar que sigue bajo el límite de 300 MB del CI (hoy
    203 MB) y que usa los binarios precompilados para Alpine (musl).
11. **Última actividad**: publicar una versión o editar actividades actualiza
    `projects.lastActivityAt` ("Mis proyectos", FR-012 de la 002).

## Complexity Tracking

Sin violaciones.
