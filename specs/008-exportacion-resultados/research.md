# Research: Exportación de requisitos y reportes

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

- **Decision**: en `analytics`, **WeasyPrint** (HTML/CSS → PDF, sin navegador) con una plantilla
  Jinja2. Secciones: portada, resumen de indicadores, diagrama con cobertura (imagen display de
  la 003 + rectángulos coloreados con Pillow según la escala de la 004), distribuciones
  (matplotlib → SVG incrustado), hallazgos del último `analysis_run` (temas, calidad,
  actividades críticas, insights con sus evidencias) y listado de requisitos agrupado por
  actividad. Si no hay análisis, las secciones analíticas se sustituyen por el texto "Análisis
  no disponible en el momento de generar el reporte".
  - **Coherencia de datos (SC-004)**: el job recibe el `runId` y un *snapshot* de los KPIs
    calculado por `api` en el momento de la solicitud (los mismos valores que muestra el
    dashboard).
- **Alternatives considered**: Chromium/Playwright para imprimir el dashboard (imagen de más de
  1 GB y frágil); `@react-pdf/renderer` en Node (habría que rehacer los gráficos).
- **Imagen**: instalar en `analytics` `libpango-1.0-0`, `libpangoft2-1.0-0` y `fonts-dejavu`
  (sustituir por la fuente del sistema de diseño si se define).

## R6. Síncrono vs. asíncrono

- **Decision**:
  - CSV, Excel o ZIP con ≤ 1 000 detalles → respuesta en streaming directa (`200` con
    `Content-Disposition`); también se registra en `exports` para auditoría.
  - Más de 1 000 detalles, o cualquier PDF → `202` con el `exportId`; job en la cola `export`
    (CSV/Excel/Gherkin los procesa un worker **Node** dentro de `api`; los PDF, el worker
    **Python**). Al terminar: archivo en el bucket, `status = ready` y evento `export:ready`
    a la sala `user:{id}` (005). Sin la 005 integrada, `ExportsList` consulta cada 5 s.
- **Rationale**: FR-006 y los tiempos de SC-001 y SC-003.

## R7. Caducidad y limpieza

- **Decision**: `expiresAt = readyAt + 24 h`; la descarga se hace con una presigned URL generada
  bajo demanda (15 min) mientras no haya caducado. Un job repetido cada hora borra los objetos
  y marca `status = expired`; además, regla de ciclo de vida del bucket a 2 días como red de
  seguridad.

## R8. Auditoría

`audit_logs` con `action: export.requested` y `diff: {format, filters, count}`; y
`export.downloaded` en cada descarga (FR-008).
