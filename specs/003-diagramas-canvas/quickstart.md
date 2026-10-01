# Quickstart: Diagramas de actividades y espacio de trabajo interactivo

Requiere 001 + 002 en marcha y un proyecto propio en estado *Abierto* o *Borrador*. En local,
`pnpm dev:up` levanta RustFS como bucket S3 (plan, ajuste 2) y activa el flag `diagrams`
(`FEATURE_FLAGS=accounts=true,diagrams=true` en Compose); en staging, el flag se activa en
`FEATURE_FLAGS` de `api`. Diagramas de ejemplo en `e2e/fixtures/diagrams/`
(`compra-simple.png`, `grande-4000x3000.png`, `cien-actividades.png`, `con-script.svg`;
`node scripts/fixtures/diagrams.mjs` los regenera).

## 1. Subida (US1)

1. En el proyecto, *Diagramas → Nuevo diagrama*, nombre "Proceso de compra", archivo
   `compra-simple.png` → se abre el espacio de trabajo en *Versión 1 · Borrador*.
2. Subir un PDF o un PNG de 15 MB → mensajes "Formato no admitido" y "Máximo 10 MB" (los
   comprueba el navegador antes de subir; la API los vuelve a validar por el contenido).
3. Subir `con-script.svg` → se muestra correctamente y en la red solo se descarga WebP
   (`…/image/display` y `…/image/thumb`): el script no llega al navegador.

## 2. Editor (US2)

Solo el Administrador, en una versión en borrador, con el proyecto sin cerrar y una pantalla de
al menos 768 px.

1. Arrastrar sobre la imagen para marcar 5 actividades; en el panel lateral, nombrarlas y
   asignar su tipo. Conectar "Validar pago" → "Emitir factura" con *Va a*. El diagrama se mueve
   con el botón derecho o la rueda; las flechas mueven la zona seleccionada (1 px, 10 px con
   Shift) y `Supr` la elimina.
2. Esperar a "Guardado" y recargar → posiciones, nombres, tipos y transición se conservan.
3. Abrir el mismo borrador en dos pestañas de Admin, mover la misma zona en ambas → la segunda
   muestra "Otro administrador modificó esta actividad" y recarga la zona.

## 3. Publicación (US3)

1. Sin zonas, *Publicar* está deshabilitado y explica por qué.
2. Publicar con 5 zonas → *Versión 1 · Publicado*. Con la cuenta de un Participante: se ve el
   diagrama, las zonas se resaltan con su nombre y se seleccionan, y no hay herramientas de
   edición.
3. *Subir versión nueva* → *Versión 2 · Borrador* con las zonas copiadas (misma `key`, visible en
   `GET /api/diagram-versions/:id`). El Participante sigue viendo la versión 1 hasta que se
   publica la 2.

## 4. Navegación (US4)

1. Abrir `grande-4000x3000.png` publicado: zoom con la rueda (del 10 % al 800 % del ajuste),
   arrastrar para desplazar, `0` para ajustar y clic en el minimapa para centrar.
2. Solo con teclado: `Tab` hasta una actividad (la vista se centra en ella), `Enter` → queda
   seleccionada y se anuncia; `+`/`-` hacen zoom, las flechas desplazan y `Esc` deselecciona.
3. Con las DevTools en modo móvil (390 px): se puede navegar y seleccionar, pero no editar.
4. Rendimiento: con `cien-actividades.png` (100 zonas) la navegación se mantiene ≥ 50 FPS
   (`pnpm e2e:perf` lo mide; resultados en plan.md, §Mediciones).

## 5. Pruebas

```bash
pnpm test:services:up                                       # MongoDB, Redis y RustFS
pnpm --filter @reqcanvas/api exec vitest run diagram activit storage image-pipeline
pnpm --filter @reqcanvas/web exec vitest run camera editor workspace diagrams
pnpm dev:up && pnpm e2e --project flows                      # E2E con E2E_HOOKS=true
pnpm e2e:perf                                                # mediciones (abre Chrome)
```
