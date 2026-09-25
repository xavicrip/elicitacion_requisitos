# Quickstart: Diagramas de actividades y espacio de trabajo interactivo

Requiere 001 + 002 en marcha (`pnpm dev:up`, que ya incluye MinIO) y un proyecto propio
en estado *Abierto*. Diagramas de ejemplo en `e2e/fixtures/diagrams/`
(`compra-simple.png`, `grande-4000x3000.png`, `con-script.svg`).

## 1. Subida (US1)

1. *Diagramas → Nuevo*, nombre "Proceso de compra", archivo `compra-simple.png` → se abre el
   editor en *Borrador*.
2. Subir un PDF o un PNG de 15 MB → mensajes "Formato no admitido" y "Máximo 10 MB".
3. Subir `con-script.svg` → se muestra correctamente y en la red solo se descarga
   `display.webp` (el script no llega al navegador).

## 2. Editor (US2)

1. Dibujar 5 zonas sobre las actividades, nombrarlas y asignar tipos; conectar
   "Validar pago" → "Emitir factura".
2. Recargar → posiciones, nombres, tipos y transición se conservan (guardado automático).
3. Abrir el mismo borrador en dos ventanas de Admin, mover la misma zona en ambas → la
   segunda muestra el aviso de conflicto y recarga la zona.

## 3. Publicación (US3)

1. Publicar sin zonas → bloqueado, con explicación.
2. Publicar con 5 zonas → *Publicado*. Con la cuenta de un Participante: se ve el diagrama,
   las zonas se resaltan y seleccionan, y no hay herramientas de edición.
3. Subir una versión 2 → el Participante sigue viendo la versión 1 hasta que se publica la 2;
   las zonas copiadas conservan su `key` (visible en `GET /api/diagram-versions/:id`).

## 4. Navegación (US4)

1. Abrir `grande-4000x3000.png` publicado: zoom con rueda, arrastre, "Ajustar" (`0`) y clic en
   el minimapa.
2. Solo con teclado: `Tab` hasta una actividad, `Enter` → queda seleccionada; `+`/`-` hacen zoom.
3. Con las DevTools en modo móvil (390 px): se puede navegar y seleccionar, pero no editar.
4. Rendimiento: con el diagrama de 100 zonas (`e2e/fixtures/diagrams/cien-actividades.png`) y el
   panel *Rendering → FPS meter* de Chrome, la navegación se mantiene ≥ 50 FPS.

## 5. Pruebas

```bash
pnpm --filter api test -- diagrams
pnpm --filter web test -- camera
pnpm e2e -- diagram-upload diagram-editor workspace-navigation
```
