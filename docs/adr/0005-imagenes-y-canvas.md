# ADR 0005: Imágenes de diagramas servidas por `api` y canvas three.js bajo demanda

- **Estado**: aceptado
- **Fecha**: 2026-09-30
- **Feature**: 003-diagramas-canvas (research R1–R6; plan, ajustes 1–11)

## Contexto

La 003 permite subir la imagen de un diagrama de actividades (PNG, JPG o SVG de hasta 10 MB),
marcar sus actividades como zonas y navegarlo en un canvas con three.js. Las imágenes necesitan
almacenamiento fuera de MongoDB, deben llegar solo a los miembros del proyecto (los Participantes,
solo las versiones publicadas) y el canvas tiene que mantenerse fluido con 100 zonas en GPU
integradas. Un SVG subido puede traer scripts o referencias externas.

## Decisión

1. **Imágenes servidas por `api`, no por URLs prefirmadas.** `GET
/diagram-versions/:id/image/{display|thumb}` lee el objeto del bucket en streaming tras
   comprobar la membresía (`requireResourceProject`) y la visibilidad de la versión. Responde con
   `Cache-Control: private, max-age=31536000, immutable` y el `ETag` del objeto (`304` con
   `If-None-Match`): una versión nunca cambia de imagen, así que la caché del navegador basta. Las
   URLs son relativas (`/api/…`) y pasan por el proxy de `web` (ADR 0004): mismo origen, sin CORS
   del bucket (Railway Buckets no lo documenta) y sin texturas WebGL "contaminadas". Como `<img>`
   y las texturas no envían el access token, `web` las pide con `fetch` y las usa como `blob:`.
   Caddy solo comprime texto, para no recomprimir el WebP ni alterar su `ETag`.
2. **Un bucket por entorno, compartido con los respaldos.** Las imágenes van bajo
   `projects/{projectId}/diagrams/{versionId}/` en el mismo Railway Bucket que `mongo-backups/`
   (ADR 0003). Las variables `S3_*` de `api` son referencias al bucket (ADR 0002). En local y en
   CI, RustFS (`S3_FORCE_PATH_STYLE` y `S3_CREATE_BUCKET`). Borrar un proyecto borra su prefijo
   en la cascada de la 002. Restaurar un respaldo de MongoDB no toca los objetos.
3. **Pipeline con `file-type` y `sharp`.** El tipo se detecta por el contenido, no por la
   extensión (PNG, JPEG o XML con raíz `<svg>`; lo demás, `415`). Un SVG se rasteriza a PNG al doble
   de su tamaño y nunca se guarda ni se sirve: así no llegan scripts ni referencias externas. Se
   guardan el original, una versión _display_ WebP (lado mayor ≤ 8192 px, el límite habitual de
   texturas en GPU integradas, sin EXIF y con la orientación aplicada) y una miniatura de 512 px
   para el minimapa. `@fastify/multipart` corta el stream a 10 MB (`413`). La imagen de `api`
   pasa de 203 a 238 MB (límite del CI: 300 MB).
4. **three.js con renderizado bajo demanda.** `@react-three/fiber` con cámara ortográfica y
   `frameloop="demand"`: solo se dibuja cuando algo cambia. 1 unidad del mundo = 1 px de la imagen
   display; las zonas se guardan normalizadas (0–1) y con una `key` estable entre versiones, el
   ancla de los requisitos de la 004. La selección no usa raycasting por zona: un plano de captura
   y una función pura eligen la zona más pequeña bajo el puntero. three.js se carga solo al abrir
   un diagrama (el bundle inicial baja de 398 a 155 kB con gzip).
5. **La cámara se mueve con órdenes.** El teclado, el minimapa y la lista accesible no tocan la
   cámara: piden `fit`, `zoom`, `pan` o `center` en el store y el canvas los aplica con una función
   pura. La navegación se prueba sin WebGL, y la lista accesible (oculta salvo con el foco) hace
   el canvas navegable con teclado.
6. **Estado expuesto solo para los E2E.** `window.__canvasState` (cámara, modo, selección, estado
   de la imagen) solo existe si `/config.js` trae `e2eHooks: true`, que el entrypoint de `web`
   escribe con `E2E_HOOKS=true` (Compose y CI; nunca Railway). Se decide en ejecución porque la
   imagen de `web` se construye siempre en modo producción.
7. **Concurrencia optimista.** Las actividades llevan `rev`: `PATCH` exige `If-Match` (`428` sin
   él) y un `rev` viejo recibe `409` con la actividad actual; el editor la recarga y avisa. El
   guardado automático agrupa los cambios 500 ms y los envía con `keepalive` al salir de la
   página. Publicar reclama el borrador con su `rev`, de modo que dos publicaciones simultáneas
   no se pisan; índices parciales únicos garantizan un solo borrador y una sola versión
   publicada por diagrama.

## Alternativas descartadas

- **URLs prefirmadas del bucket**: menos carga para `api`, pero exigen CORS en el bucket (no
  documentado en Railway Buckets) para usar las imágenes como texturas WebGL, y las URLs caducan
  y circulan fuera de la app.
- **Sanear el SVG (DOMPurify) y renderizarlo como SVG**: riesgo residual y peor rendimiento en
  WebGL que una textura rasterizada.
- **GridFS o un Railway Volume**: cargan MongoDB con binarios o atan el estado a una instancia
  de `api`.
- **Canvas 2D o Konva**: no cumplen el requisito de three.js; `InstancedMesh` no hace falta con
  ≤ 100 zonas.

## Consecuencias

- Cada visualización pasa por `api`, aunque la caché del navegador (`immutable`) evita repetirlo:
  medido en local, un diagrama de 100 zonas es navegable en 2,1 s con 10 Mbps y sin caché, y se
  mueve a 60 FPS (plan, §Mediciones). Si el tráfico de imágenes creciera, se podría volver a URLs
  prefirmadas con CORS en el bucket sin cambiar el contrato de `web`.
- Las imágenes cuentan en el ancho de banda de `api` y del proxy de `web`.
- Publicar no es una transacción de MongoDB (no se asume un replica set): un fallo entre archivar
  la versión anterior y publicar la nueva dejaría un instante el diagrama sin versión publicada,
  sin perder el borrador. Los índices únicos impiden que haya dos publicadas.
- Chromium headless renderiza WebGL por software: las mediciones de FPS (`pnpm e2e:perf`)
  necesitan ventana y no corren en el CI.
- Hay que verificar en staging que el borde de Railway acepta subidas de 10 MB (T058).
