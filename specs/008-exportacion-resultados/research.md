# Research: Exportación de requisitos y reportes

> Actualizado el 2026-10-03 con los «Ajustes tras implementar la 002–007» de `plan.md` (R5–R8).

**Feature**: 008-exportacion-resultados | **Date**: 2026-09-25

## R1. CSV compatible con hojas de cálculo

- **Decision**: `csv-stringify` en streaming, separador `,`, comillas en todos los campos,
  saltos de línea `\r\n`, **BOM UTF-8** al inicio (Excel detecta así la codificación y muestra
  bien tildes y "ñ"). Los saltos de línea dentro de un campo se conservan entrecomillados (una
  fila por detalle en Excel, LibreOffice y Google Sheets).
- **Alternatives considered**: separador `;` para configuraciones regionales en español (se
  ofrece como opción `delimiter=semicolon`, porque en Ecuador el separador decimal es `,` y
  Excel espera `;`).

## R2. Inyección de fórmulas (CSV/Excel)

- **Decision**: `neutralizeFormula(v)`: si el valor empieza por `=`, `+`, `-`, `@`, tabulador
  o retorno de carro, se antepone un apóstrofo (`'`). En Excel (`exceljs`), además, todas las
  celdas se escriben como tipo *string* explícito.
- **Rationale**: recomendación de OWASP (CSV Injection); edge case de la spec.

## R3. Excel

- **Decision**: `exceljs.stream.xlsx.WorkbookWriter` (memoria constante), hoja "Requisitos" con
  encabezados congelados, autofiltro y anchos de columna, y una hoja "Resumen" con conteos por
  actividad y tipo.

## R4. Gherkin en español

- **Decision**: plantilla por actividad:

  ```gherkin
  # language: es
  @diagrama-proceso-de-compra
  Característica: Validar pago
    Requisitos levantados para la actividad "Validar pago" del diagrama "Proceso de compra".

    @must @no-funcional @pagos @validado
    Escenario: Confirmación de pago con tarjeta
      Dado el cliente tiene productos en el carrito
      Cuando paga con tarjeta
      Entonces el sistema confirma el pago en menos de 5 segundos
  ```

  - Nombre del escenario: las primeras 8 palabras de "Entonces" + `#<id corto>` si se repite.
  - Etiquetas: prioridad, tipo, estado y etiquetas del detalle, normalizadas (`kebab-case`,
    sin tildes ni espacios).
  - Los textos con varias líneas se unen en una sola; se escapan los caracteres especiales de
    Gherkin (`|`, `"""`, `#` al inicio de línea).
  - Archivo: `<diagrama>/<actividad>.feature` con `safeFileName` (sin tildes, minúsculas,
    `[a-z0-9-]`, máximo 80 caracteres, sufijo numérico si colisionan).
  - Por defecto solo `validated`; opción `includePending`.
- **Validación**: cada archivo se analiza en las pruebas con `@cucumber/gherkin`
  (dialecto `es`) sin errores (SC-002).

## R5. Reporte PDF

- **Decision**: en `analytics-worker`, **WeasyPrint** (HTML/CSS → PDF, sin navegador) con una
  plantilla Jinja2 con autoescape. Secciones: portada, resumen de indicadores, diagrama con
  cobertura (imagen display de la 003 + rectángulos coloreados con Pillow según la escala de la
  004), distribuciones (barras en SVG incrustado, con la paleta del dashboard), hallazgos del
  último análisis terminado (temas, calidad, actividades críticas, reglas e insights con sus
  evidencias) y listado de requisitos agrupado por actividad. Si no hay análisis, o una parte se
  omitió o falló, se sustituye por el texto "Análisis no disponible en el momento de generar el
  reporte".
  - **Coherencia de datos (SC-004)**: `api` calcula la instantánea con `descriptive.service` de
    la 007 y los mismos filtros en el momento de la solicitud y la escribe en el archivo de
    entrada; el worker no recalcula nada.
  - **Sin acceso a datos**: el worker recibe una URL firmada de lectura (entrada) y otra de
    escritura (PDF); no accede a MongoDB ni tiene credenciales del bucket. La entrada no lleva
    nombres de personas.
- **Alternatives considered**: Chromium/Playwright para imprimir el dashboard (imagen de más de
  1 GB y frágil); `@react-pdf/renderer` en Node (habría que rehacer los gráficos); matplotlib
  para los gráficos (dependencia pesada para unas barras); un servicio nuevo solo para el PDF.
- **Imagen**: instalar en `analytics` `libpango-1.0-0`, `libpangoft2-1.0-0`,
  `libharfbuzz-subset0` y `fonts-dejavu-core`.

## R6. Síncrono vs. asíncrono

- **Decision**:
  - CSV, Excel o ZIP con ≤ 1 000 detalles → respuesta en streaming directa (`200` con
    `Content-Disposition`); se registra en `exports` (`sync`, `done`, sin archivo guardado) para
    la auditoría y el historial.
  - Más de 1 000 detalles, o cualquier PDF → `202` con el `Export`; CSV, Excel y Gherkin los
    genera un `Worker` de BullMQ dentro de `api` (cola `export-files`) y los PDF, el worker
    Python (cola `export`). Al terminar: archivo en el bucket y `status = done`. La web consulta
    `GET /exports/:id` cada 3 s y avisa «Tu exportación está lista».
  - Una exportación en curso por proyecto y formato (409 `EXPORT_IN_PROGRESS`).
- **Rationale**: FR-006 y los tiempos de SC-001 y SC-003. Las salas de la 005 son por diagrama,
  así que no se añade un evento de socket (como en la 007).

## R7. Caducidad y limpieza

- **Decision**: `expiresAt = finishedAt + 24 h`. `GET /exports/:id/download` sirve el archivo
  desde el bucket a través de `api` mientras no haya caducado (410 después). Un `JobScheduler`
  de BullMQ cada hora borra los objetos caducados y vacía `fileKey`. Los archivos viven bajo el
  prefijo del proyecto, que la cascada de borrado elimina.

## R8. Auditoría

`auditService` con `action: export.requested` y `diff: {format, filters, options, count}`; y
`export.downloaded` en cada descarga (FR-008).
