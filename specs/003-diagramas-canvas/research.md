# Research: Diagramas de actividades y espacio de trabajo interactivo

**Feature**: 003-diagramas-canvas | **Date**: 2026-09-25

## R1. Almacenamiento de imágenes

- **Decision**: bucket **compatible con S3** con `@aws-sdk/client-s3` y `forcePathStyle`
  configurable. En Railway, un **Railway Bucket** por entorno (`reqcanvas-staging`,
  `reqcanvas`), el mismo de los respaldos de migraciones (ADR 0003), con las imágenes bajo
  `projects/{projectId}/diagrams/{versionId}/`. En local y en CI, **RustFS** (servicio `s3` de
  `infra/docker-compose.yml`, de `infra/docker-compose.test.yml` y del job de CI). El bucket es
  privado y las imágenes las sirve `api` por el proxy de `web`, con caché `immutable` y `ETag`
  (ADR 0005).
  *Revisado el 2026-09-30 (plan, ajustes 1–3)*: la decisión inicial eran **presigned GET URLs**
  de 1 h y **MinIO** en local. Se descartaron las URLs firmadas porque Railway Buckets no
  documenta CORS y WebGL lo exige para usar la imagen como textura; MinIO, por RustFS (Apache 2.0,
  ya usado por los respaldos).
- **Rationale**: el cliente S3 funciona igual con Railway, R2 y RustFS; servir desde `api`
  mantiene el mismo origen y comprueba la membresía en cada imagen, y la caché del navegador
  evita repetir la descarga (medido: navegable en 2,1 s con 10 Mbps, plan §Mediciones).
- **Alternatives considered**: presigned URLs (ver arriba); Railway Volume montado en `api`
  (acopla el estado a una instancia e impide escalar horizontalmente, contra el Principio II);
  GridFS (sobrecarga MongoDB con binarios).
- **Nota**: si la cuenta de Railway no dispone de Buckets, se usa Cloudflare R2 sin cambios de
  código (solo las variables `S3_*`).

## R2. Validación y procesamiento de la imagen

- **Decision**: `@fastify/multipart` con `limits.fileSize = 10 MB` (corta el stream);
  `file-type` detecta el tipo por *magic bytes* (PNG, JPEG) y, para SVG, se comprueba que sea
  XML con raíz `<svg>`. `sharp`:
  1. **SVG → PNG** a 2× de su tamaño intrínseco (máx. 8192 px), lo que elimina scripts y
     referencias externas; el SVG original no se sirve nunca.
  2. **display**: WebP con calidad 90, lado mayor ≤ 8192 px, sin metadatos EXIF (orientación aplicada).
  3. **thumb**: WebP con lado mayor de 512 px para el minimapa.
  Se guardan `width` y `height` de la versión *display*.
- **Rationale**: FR-001 y edge cases de SVG e imágenes enormes; WebP reduce el peso (SC-003).
- **Alternatives considered**: sanear el SVG con DOMPurify y renderizarlo como SVG (riesgo
  residual y rendimiento peor en WebGL).

## R3. Renderizado del canvas con three.js

- **Decision**: `@react-three/fiber` con `<Canvas orthographic frameloop="demand">`; un
  `planeGeometry` del tamaño en píxeles de la imagen con la textura (`useTexture`,
  `colorSpace = SRGBColorSpace`, `anisotropy` máxima, `generateMipmaps`). Las zonas son
  `mesh` con `planeGeometry` y `MeshBasicMaterial` transparente, más un borde
  (`lineSegments`), y se colocan en `z = 1` sobre la imagen. Las etiquetas usan `Text` (troika).
  `frameloop="demand"` solo redibuja cuando cambia algo.
- **Rationale**: prompt.md exige three.js; el renderizado bajo demanda y ≤ 100 meshes caben de
  sobra en el presupuesto de 50 FPS incluso en GPU integradas.
- **Alternatives considered**: Canvas 2D o Konva (no cumplen el requisito de three.js);
  `InstancedMesh` (innecesario con ≤ 100 zonas; se reconsidera si se supera ese número).

## R4. Navegación (zoom, desplazamiento, ajustar, minimapa)

- **Decision**: `MapControls` de drei con `enableRotate=false`, `zoomToCursor=true`,
  `screenSpacePanning=true`, `minZoom` y `maxZoom` calculados para el rango del 10 % al 800 %
  respecto al zoom de "ajustar a pantalla". Funciones puras en `camera/zoom.ts`
  (`fitZoom(viewport, image)`, `clampPan`, `screenToImage`, `imageToScreen`) con pruebas
  unitarias. El **minimapa** es HTML: `<img>` de la miniatura y un rectángulo del viewport
  calculado a partir de la cámara; un clic centra la cámara. Teclado: `+`/`-` para zoom,
  flechas para desplazar, `0` para ajustar.
- **Rationale**: FR-009 y FR-011; la lógica pura se prueba sin WebGL.

## R5. Selección y accesibilidad

- **Decision**: raycasting de R3F (`onPointerOver`, `onClick`); si hay zonas superpuestas, se
  selecciona la de menor área (edge case) ordenando las intersecciones. Una
  **lista accesible** (`A11yActivityList`, visualmente oculta pero enfocable) replica las
  actividades como botones: tabular entre ellos mueve la cámara a la actividad, `Enter` la
  selecciona y el foco muestra el resaltado en el canvas. `aria-live` anuncia la selección.
- **Rationale**: un canvas WebGL no es accesible por sí mismo; RNF-05 exige WCAG 2.1 AA en la
  interacción.

## R6. Editor de zonas

- **Decision**: modo *edición* (solo Admin, pantallas ≥ 768 px): arrastrar sobre un área vacía
  dibuja un rectángulo; 8 *handles* para redimensionar; arrastrar la zona la mueve; `Supr`
  la elimina. Las coordenadas se guardan **normalizadas (0–1)** respecto a la imagen display.
  El guardado automático (`useAutosave`, debounce de 500 ms) hace `PATCH` con `If-Match: <rev>`;
  un `409` recarga la actividad y muestra el aviso "Otro administrador modificó esta actividad".
  Las transiciones se crean seleccionando el origen y pulsando "Conectar con…" sobre el
  destino, y se dibujan como flechas (`Line` de drei).
- **Rationale**: FR-003 a FR-006 y el edge case de edición concurrente; las coordenadas
  normalizadas no dependen de la resolución de la imagen.

## R7. Versiones y claves estables

- **Decision**: cada `activity` tiene `key` (UUID) estable. Al crear una nueva versión, se
  copian las actividades de la versión anterior conservando su `key` (FR-008). Al publicar
  una versión, la anterior pasa a `archived`. La 004 ancla los requisitos a
  `(diagramId, activityKey)`, por lo que los requisitos de actividades conservadas siguen
  visibles, y los de actividades eliminadas quedan huérfanos, que la 004 gestiona.
- **Alternatives considered**: anclar a `activity._id` (se perdería el vínculo en cada versión).

## R8. Compatibilidad WebGL y móvil

- **Decision**: comprobación `WebGL2RenderingContext` al montar; si falla, se muestra un mensaje
  con los navegadores compatibles. En viewport < 768 px se desactivan el modo edición y las
  acciones de escritura (FR-010). El gesto de pellizco se gestiona con `MapControls` (touch).

## R9. Variables de entorno nuevas

De `api` (`specs/001-plataforma-base/contracts/env-vars.md`, ADR 0002):

| Variable | Railway | Local y CI (RustFS) |
|----------|---------|---------------------|
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Referencias al bucket del entorno: `${{reqcanvas-staging.ENDPOINT}}`… en staging, `${{reqcanvas.ENDPOINT}}`… en producción | `http://s3:9000` (Compose) o `S3_TEST_URL`, bucket `reqcanvas`, `us-east-1`, `rustfsadmin` |
| `S3_FORCE_PATH_STYLE` | Sin definir (`false`) | `true` |
| `S3_CREATE_BUCKET` | Sin definir (`false`) | `true` (RustFS no crea el bucket) |

De `web`: `E2E_HOOKS=true` solo en Compose y en el CI (expone `window.__canvasState`); nunca
en Railway. En GitHub Actions no hacen falta las `S3_*`: el despliegue solo invoca `railway up`.
Sin las `S3_*` obligatorias, `api` no arranca.
