---
description: "Task list for feature 008-exportacion-resultados"
---

# Tasks: Exportación de requisitos y reportes

**Input**: Design documents from `/specs/008-exportacion-resultados/`
**Prerequisites**: plan.md (incluidos los "Ajustes tras implementar la 002–007"), spec.md,
research.md, data-model.md, contracts/export-job.md, contracts/export-formats.md,
contracts/exports.openapi.yaml, quickstart.md

**Tests**: OBLIGATORIAS (Principio III). Cada par prueba + implementación va en el mismo commit.
Las pruebas de `api` usan MongoDB, Redis y RustFS reales (`pnpm test:services:up`) y un **worker
falso en Node** que consume la cola `export`, descarga la entrada por la URL firmada y sube un
PDF fijo (como `tests/helpers/analysis-worker.ts`); los tiempos (timeout del job, latido del
worker, caducidad) se inyectan por opciones. Las de `analytics` usan pytest y leen el PDF con
`pypdf`. Los E2E siguen el patrón de la 007 (`e2e/flows/`) contra Compose con el worker real.

**Commits**: Conventional Commits, un commit atómico por tarea o par; el tipo y alcance
sugeridos van al final de cada tarea.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia de usuario (US1–US3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: decisión de arquitectura y dependencias

- [X] T001 ADR `docs/adr/0010-exportacion.md` antes de introducir las tecnologías nuevas (restricciones de la constitución): CSV, Excel y Gherkin en `api` en streaming (`csv-stringify`, `exceljs`, `archiver`); PDF en `analytics-worker` con WeasyPrint y Jinja2, sin acceso a MongoDB ni credenciales del bucket (URLs firmadas); gráficos en SVG sin matplotlib; aviso por consulta periódica; descarga a través de `api`; alternativas descartadas (Chromium, `@react-pdf/renderer`, colección compartida, servicio nuevo) — `docs(adr)`
- [X] T002 Dependencias: en `apps/api` `csv-stringify`, `exceljs` y `archiver` (y `@types/archiver`), y como dependencias de desarrollo `@cucumber/gherkin`, `@cucumber/messages` y `yauzl` (leer el ZIP en las pruebas); en `apps/analytics/pyproject.toml` `weasyprint`, `jinja2` y `pillow`, y `pypdf` en el grupo de desarrollo; en `apps/analytics/Dockerfile` las librerías de sistema de WeasyPrint (`libpango-1.0-0`, `libpangoft2-1.0-0`, `libharfbuzz-subset0`) y `fonts-dejavu-core`; las mismas librerías en el job `test-python` de `.github/workflows/ci.yml`; overrides de mypy para las librerías sin tipos — `build(repo)`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contrato, flag, colección, selección de detalles con filtros y rutas comunes

**⚠️ CRITICAL**: ninguna historia puede empezar hasta completar esta fase

- [X] T003 [P] Pruebas de `packages/shared/src/exports.ts` en `packages/shared/tests/exports.test.ts`: `ExportRequest` (`format` en `csv|xlsx|gherkin|pdf`, `filters` como `DashboardFilters`, `options` con `delimiter` `comma` por defecto e `includePending` `false`), `Export` (estados `pending|running|done|failed`, `expired`, `fileName`), `ExportJobInput` v1, `ExportInputFile` (`schemaVersion` 1) y `ExportJobReturn` (`done` con `bytes` y `pages`; `failed` exige `error.code`), validando los ejemplos de `apps/analytics/tests/contract/examples/export/` — `test(shared)`
- [X] T004 Implementar `packages/shared/src/exports.ts`, exportarlo desde `packages/shared/src/index.ts` y crear los ejemplos de contrato (`job-input.json`, `input-file.json`, `input-file-no-analysis.json`, `return-done.json`, `return-failed.json`) en `apps/analytics/tests/contract/examples/export/` — `feat(shared)`
- [X] T005 [P] Pruebas del flag en `apps/api/tests/integration/exports-flag.test.ts`: `exports` desactivado por defecto y de la 008; sin él, `/projects/:id/exports` y `/exports/*` responden 404 y `GET /config` lo informa; el patrón no cubre rutas parecidas — `test(api)`
- [X] T006 Implementar el flag `exports` en `packages/shared/src/flags.ts`, su patrón en `GATED_PREFIXES` de `apps/api/src/plugins/flags.ts` y `docs/feature-flags.md`; `FEATURE_FLAGS` por defecto `exports=true` en `infra/docker-compose.yml` y en el job `e2e-smoke` de `.github/workflows/ci.yml` — `feat(shared)`
- [X] T007 [P] Pruebas de la migración y de la cascada en `apps/api/tests/integration/exports-migration.test.ts` y `exports-cascade.test.ts`: `up` crea los índices `{projectId, createdAt: -1}` y el parcial `{expiresAt}` y `down` los elimina; borrar un proyecto elimina sus `exports` y deja los de otros proyectos — `test(api)`
- [X] T008 Implementar `apps/api/migrations/20261105000000-exports-indexes.js`, el modelo `apps/api/src/modules/exports/models/export.ts` (data-model.md) y `apps/api/src/modules/exports/cascade.ts` (`registerExportsCascade`, registrado en `apps/api/src/app.ts` aunque el flag esté desactivado) — `feat(api)`
- [X] T009 [P] Pruebas de `apps/api/src/modules/exports/sanitize.ts` en `apps/api/tests/unit/exports-sanitize.test.ts`: `neutralizeFormula` antepone `'` a los valores que empiezan por `=`, `+`, `-`, `@`, tabulador o retorno de carro y deja intactos los demás (incluidos números negativos como texto); `safeFileName` quita tildes, pasa a minúsculas, deja `[a-z0-9-]`, corta a 80 caracteres, nunca devuelve vacío y resuelve colisiones con sufijo numérico; `exportFileName` con la zona horaria del proyecto — `test(api)`
- [X] T010 Implementar `apps/api/src/modules/exports/sanitize.ts` — `feat(api)`
- [X] T011 [P] Pruebas de `apps/api/src/modules/exports/query.ts` en `apps/api/tests/integration/exports-query.test.ts`: el cursor de filas respeta los filtros de la 007 (diagrama, fechas en la zona del proyecto, tipo y estados), ordena por diagrama, actividad y fecha, resuelve nombre del diagrama, etiqueta de la actividad publicada («(huérfano)» si ya no existe), nombre del autor e ID corto del original de un duplicado, y cuenta sin materializar (`count`) — `test(api)`
- [X] T012 Implementar `apps/api/src/modules/exports/query.ts` (reutiliza `dashboard/filters.ts`; cursor de Mongoose, sin cargar todos los detalles en memoria) — `feat(api)`
- [X] T013 [P] Pruebas de contrato y de permisos en `apps/api/tests/contract/exports.contract.test.ts` y `apps/api/tests/integration/exports.test.ts` para las rutas comunes: `GET /projects/:id/exports` devuelve el historial (más reciente primero) con el esquema estricto; `GET /exports/:id` el estado; un Participante recibe 403 y un ajeno 404 en todas; `POST` con un formato desconocido responde 400 con el campo. El archivo de contrato se amplía en cada historia con las respuestas de `POST` (200 con sus cabeceras, 202, 409, 422, 503) y de la descarga (200, 409, 410) (constitución III) — `test(api)`
- [X] T014 Implementar `apps/api/src/modules/exports/service.ts` (`create`, `toDto` con `expired`, `list`, `get`) y `apps/api/src/modules/exports/routes.ts` con las rutas de listado y estado y el esqueleto de `POST /projects/:projectId/exports` (501 `FORMAT_NOT_AVAILABLE` hasta que cada historia añada su formato; respuesta temporal, fuera del OpenAPI y detrás del flag); registrarlas en `apps/api/src/app.ts` detrás del flag — `feat(api)`

**Checkpoint**: contrato, flag, colección y selección de detalles listos; las historias pueden empezar

---

## Phase 3: User Story 1 - Exportar requisitos a hoja de cálculo (Priority: P1) 🎯 MVP

**Goal**: el Administrador descarga los detalles (todos o los filtrados) en CSV o Excel

**Independent Test**: exportar «Tienda demo» (80 detalles) y comprobar 80 filas con las 18
columnas, acentos correctos y sin fórmulas activas

### Tests for User Story 1

- [X] T015 [P] [US1] Pruebas de `apps/api/src/modules/exports/csv.ts` en `apps/api/tests/unit/exports-csv.test.ts`: BOM UTF-8, `\r\n`, todos los campos entre comillas, las 18 columnas de `contracts/export-formats.md` en orden, tildes y «ñ», comas, comillas y saltos de línea dentro de un campo (una fila por detalle al leerlo con `csv-parse`), delimitador `;` con `semicolon`, valores traducidos (tipo, prioridad, estado), etiquetas unidas con `; `, fechas ISO-8601 y neutralización de fórmulas en todas las celdas de texto; sin detalles, solo encabezados — `test(api)`
- [X] T016 [P] [US1] Pruebas de `apps/api/src/modules/exports/xlsx.ts` en `apps/api/tests/unit/exports-xlsx.test.ts` (leyendo el resultado con `exceljs`): hoja «Requisitos» con encabezados congelados, autofiltro y las 18 columnas; celdas de texto como cadena (un `=HYPERLINK(...)` queda literal), votos y comentarios numéricos, fechas como fecha en la zona del proyecto; hoja «Resumen» con conteos por actividad y por tipo — `test(api)`
- [X] T017 [P] [US1] Pruebas de integración en `apps/api/tests/integration/exports-sheets.test.ts`: `POST /projects/:id/exports` con `csv` y `xlsx` y ≤ 1 000 detalles responde 200 con el archivo, `Content-Type`, `Content-Disposition` (`reqcanvas-<proyecto>-<fecha>.<ext>`) y `X-Export-Id`; con `statuses: ['validated']` solo salen los validados; queda un `exports` `sync` y `done` sin `fileKey` y un `audit_logs` `export.requested` con formato, filtros y número de detalles; un proyecto sin detalles devuelve solo los encabezados y la cabecera `X-Export-Empty: true`; el contrato de la respuesta 200 en `exports.contract.test.ts` — `test(api)`
- [X] T018 [P] [US1] Pruebas de la vía asíncrona en `apps/api/tests/integration/exports-async.test.ts` (umbral inyectado a 5 detalles): por encima del umbral responde 202 con el `Export` `pending`; el worker de `export-files` lo deja `done` con `fileKey`, `bytes`, `fileName` y `expiresAt` a 24 h; `GET /exports/:id/download` sirve el archivo con su `Content-Disposition` y registra `export.downloaded`; antes de terminar responde 409; un fallo al generar lo deja `failed` con `EXPORT_FAILED`; una segunda solicitud del mismo formato con una en curso responde 409 `EXPORT_IN_PROGRESS`; el log de fin incluye duración y bytes (constitución VI); el contrato de 202, 409 y de la descarga en `exports.contract.test.ts` — `test(api)`
- [X] T019 [P] [US1] Pruebas de caducidad en `apps/api/tests/integration/exports-expiry.test.ts`: con `expiresAt` en el pasado, el DTO marca `expired` y la descarga responde 410 «El enlace caducó»; la limpieza (`app.exportFiles.sweep()`) borra el objeto del bucket y vacía `fileKey`, sin tocar los no caducados — `test(api)`
- [X] T020 [P] [US1] Pruebas de `apps/web/src/features/exports/` en `apps/web/tests/exports.test.tsx`: el menú *Exportar* aparece en el dashboard solo con el flag y para el Administrador; CSV y Excel envían los filtros activos y el delimitador elegido y descargan el archivo (Blob); con 202 muestra «Preparando la exportación…», consulta cada 3 s y avisa «Tu exportación está lista» con el enlace de descarga; el historial muestra estado, fecha, tamaño y «Caducada»; con `X-Export-Empty` avisa «No hay requisitos con estos filtros»; un error (incluido `EXPORT_IN_PROGRESS`) muestra su mensaje — `test(web)`

### Implementation for User Story 1

- [X] T021 [US1] Implementar `apps/api/src/modules/exports/csv.ts` y `apps/api/src/modules/exports/columns.ts` (las 18 columnas compartidas con Excel) — `feat(api)`
- [X] T022 [US1] Implementar `apps/api/src/modules/exports/xlsx.ts` con `exceljs.stream.xlsx.WorkbookWriter` — `feat(api)`
- [X] T023 [US1] Añadir `csv` y `xlsx` a `POST /projects/:projectId/exports` en `apps/api/src/modules/exports/routes.ts`: respuesta en streaming por debajo del umbral, registro en `exports` y auditoría — `feat(api)`
- [X] T024 [US1] Implementar `apps/api/src/jobs/export-files.ts` (cola `export-files`, `Worker` en `api`, subida al bucket, `sweep` y `JobScheduler` horario; opciones inyectables) y `GET /exports/:exportId/download` en `apps/api/src/modules/exports/routes.ts`; registrar el plugin en `apps/api/src/app.ts` — `feat(api)`
- [X] T025 [US1] Implementar `apps/web/src/features/exports/{api.ts,ExportMenu.tsx,ExportsList.tsx,useExport.ts}` e integrarlos en `apps/web/src/features/dashboard/DashboardPage.tsx` detrás de `FlagGate` — `feat(web)`
- [X] T026 [US1] E2E en `e2e/flows/exports.spec.ts` (quickstart §1 y §4.2): con «Tienda demo», exportar a Excel y a CSV desde el dashboard, comprobar el nombre del archivo y las 80 filas, exportar solo los validados, y que un Participante no ve el menú y recibe 403 por la API — `test(e2e)`

**Checkpoint**: US1 funcional y demostrable de forma independiente (MVP)

---

## Phase 4: User Story 2 - Exportar escenarios en Gherkin (Priority: P2)

**Goal**: el Administrador descarga un ZIP con un `.feature` en español por actividad

**Independent Test**: exportar, descomprimir y analizar cada archivo con `@cucumber/gherkin`
(dialecto `es`) sin errores

### Tests for User Story 2

- [X] T027 [P] [US2] Pruebas de `apps/api/src/modules/exports/gherkin.ts` en `apps/api/tests/unit/exports-gherkin.test.ts`: cada `.feature` empieza por `# language: es`, lleva la etiqueta del diagrama, la *Característica* con el nombre de la actividad y un *Escenario* por detalle con sus pasos; etiquetas del escenario con prioridad, tipo, estado y etiquetas normalizadas (`@must @no-funcional @pagos @validado`); nombre del escenario con las 8 primeras palabras de «Entonces» y `#<id corto>` si se repite; textos de varias líneas unidos en una y caracteres especiales (`|`, `"""`, `#` inicial, `@` inicial) que no rompen el análisis; **todos los archivos se analizan con `@cucumber/gherkin` sin errores (SC-002)**, incluidos los generados con los 300 detalles del conjunto de validación — `test(api)`
- [X] T028 [P] [US2] Pruebas de integración en `apps/api/tests/integration/exports-gherkin.test.ts`: `POST` con `gherkin` devuelve `reqcanvas-<proyecto>-gherkin.zip` con `<diagrama>/<actividad>.feature` (nombres con `safeFileName`, sin colisiones); por defecto solo los validados y con `includePending` también los pendientes, sea cual sea `filters.statuses`; no hay archivo para actividades sin escenarios; un proyecto sin detalles validados devuelve un ZIP con un `LEEME.txt` que lo indica — `test(api)`
- [X] T029 [P] [US2] Pruebas en `apps/web/tests/exports.test.tsx`: la opción *Gherkin* con la casilla *Incluir pendientes* envía `includePending` y descarga el ZIP — `test(web)`

### Implementation for User Story 2

- [X] T030 [US2] Implementar `apps/api/src/modules/exports/gherkin.ts` (render de cada `.feature` y ZIP con `archiver`) — `feat(api)`
- [X] T031 [US2] Añadir `gherkin` a `POST /projects/:projectId/exports` y al worker de `apps/api/src/jobs/export-files.ts` — `feat(api)`
- [X] T032 [US2] Añadir la opción Gherkin a `apps/web/src/features/exports/ExportMenu.tsx` y ampliar `e2e/flows/exports.spec.ts` (quickstart §2: el ZIP contiene un `.feature` por actividad con detalles validados y aumenta con *Incluir pendientes*) — `feat(web)`

**Checkpoint**: US1 y US2 funcionan de forma independiente

---

## Phase 5: User Story 3 - Reporte PDF del levantamiento (Priority: P2)

**Goal**: el Administrador genera en segundo plano un PDF con portada, diagramas con cobertura,
indicadores, hallazgos y el listado de requisitos por actividad

**Independent Test**: generar el PDF de «Tienda demo» y comprobar que tiene todas las secciones
y que sus indicadores coinciden con los del dashboard

### Tests for User Story 3

- [X] T033 [P] [US3] Prueba de contrato del lado Python en `apps/analytics/tests/contract/test_export_job.py`: los ejemplos de `examples/export/` validan contra los modelos pydantic y los inválidos (`v` distinto de 1, `schemaVersion` desconocido, retorno `failed` sin código) se rechazan — `test(analytics)`
- [X] T034 [P] [US3] Pruebas del reporte en `apps/analytics/tests/unit/test_report_pdf.py` (leyendo el PDF con `pypdf`): con el ejemplo completo están las seis secciones de `contracts/export-formats.md`, los KPIs impresos son los de `descriptive.kpis` (SC-004), aparece cada actividad con sus requisitos en formato Dado/Cuando/Entonces (con su rol, sin autor), sin detalles las secciones lo indican, los hallazgos citan IDs cortos, hay pie con número de página y «Generado por ReqCanvas»; sin análisis, o con una etapa omitida o fallida, la parte correspondiente dice «Análisis no disponible en el momento de generar el reporte»; el texto de los detalles se escapa (un `<script>` o `<img>` sale literal); 2 000 detalles generan el PDF sin error — `test(analytics)`
- [X] T035 [P] [US3] Pruebas de `apps/analytics/src/analytics/reports/coverage_image.py` y `charts.py` en `apps/analytics/tests/unit/test_report_graphics.py`: la imagen de cobertura conserva las proporciones del diagrama y colorea cada zona según la escala de la 004 (0 detalles distinto de muchos), con un diagrama que no se puede descargar se usa un marcador y el reporte se genera igual; las barras SVG tienen una barra por categoría con su etiqueta y valor y no fallan con listas vacías — `test(analytics)`
- [X] T036 [P] [US3] Pruebas del worker en `apps/analytics/tests/unit/test_export_worker.py` (HTTP simulado): descarga la entrada, sube el PDF con `PUT` y `Content-Type: application/pdf` y devuelve `done` con `bytes` y `pages`; un fallo de descarga, de subida o de generación devuelve `failed` con su código; el proceso de `analytics-worker` consume las colas `detection` y `export`, escribe un latido por cola y su `/health` refleja ambas; el log de fin incluye duración, bytes y páginas — `test(analytics)`
- [X] T037 [P] [US3] Pruebas de integración en `apps/api/tests/integration/exports-pdf.test.ts` (worker falso): `POST` con `pdf` responde 202, escribe `input.json.gz` con la instantánea de `descriptive.service` para los mismos filtros, los diagramas publicados con sus actividades y la URL firmada de su imagen, los detalles sin nombres ni identificadores de personas y el último análisis terminado tal como lo muestra el dashboard (sin pares decididos ni insights no útiles; `null` si no hay); al terminar queda `done` con `bytes` y `expiresAt`, se borra la entrada y la descarga sirve el PDF; sin diagramas publicados responde 422 `NO_DIAGRAMS`; sin latido de la cola `export`, 503 `WORKER_UNAVAILABLE`, y `/health/deep` incluye el check `export-worker`; con un PDF en curso, 409 `EXPORT_IN_PROGRESS`; sin detalles, el PDF se genera con `detailCount: 0`; si el worker no responde, `failed` con `TIMEOUT`; un retorno inválido, `failed` con `EXPORT_FAILED`; el contrato de 202, 422 y 503 en `exports.contract.test.ts` — `test(api)`
- [X] T038 [P] [US3] Pruebas en `apps/web/tests/exports.test.tsx`: *Reporte PDF* muestra el progreso, avisa cuando está listo y permite descargarlo; los errores `NO_DIAGRAMS` y `WORKER_UNAVAILABLE` muestran su mensaje — `test(web)`

### Implementation for User Story 3

- [X] T039 [US3] Implementar `apps/analytics/src/analytics/reports/schemas.py` (pydantic, espejo del contrato v1) — `feat(analytics)`
- [X] T040 [US3] Implementar `apps/analytics/src/analytics/reports/{charts.py,coverage_image.py}` — `feat(analytics)`
- [X] T041 [US3] Implementar `apps/analytics/src/analytics/reports/pdf.py` y `templates/{report.html.j2,report.css}` (Jinja2 con autoescape y WeasyPrint) — `feat(analytics)`
- [X] T042 [US3] Implementar `apps/analytics/src/analytics/reports/worker.py` y hacer que `apps/analytics/src/analytics/worker.py` consuma también la cola `export` sobre `queue_worker.py` — `feat(analytics)`
- [X] T043 [US3] Implementar `apps/api/src/jobs/export-pdf.ts` (cola `export`, `QueueEvents`, timeout, latido de la cola y check `export-worker` en `apps/api/src/routes/health.ts`, como `jobs/analysis.ts`), `apps/api/src/modules/exports/report-input.ts` (archivo de entrada) y añadir `pdf` a `POST /projects/:projectId/exports`; helper de pruebas `apps/api/tests/helpers/export-worker.ts` — `feat(api)`
- [X] T044 [US3] Añadir *Reporte PDF* a `apps/web/src/features/exports/ExportMenu.tsx` y ampliar `e2e/flows/exports.spec.ts` con el worker real (quickstart §3: tras un análisis de «Tienda demo», generar el PDF, descargarlo y comprobar que es un PDF con más de una página) — `feat(web)`

**Checkpoint**: las tres historias funcionan de forma independiente

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T045 [P] Mediciones en `e2e/perf/exports.perf.spec.ts` (sin navegador), extrayendo la inserción de volumen con `mongosh` a `e2e/perf/volume.ts`: CSV y Excel de 2 000 detalles listos en < 10 s (SC-001) y PDF de 2 000 detalles en < 2 min (SC-003), con la memoria máxima de `analytics-worker`; como referencia, 5 000 detalles; anotarlo en `plan.md` — `perf(e2e)`
- [X] T046 [P] Completar el ADR 0010 con las mediciones, README (sección de exportación: formatos, flag `exports`, caducidad de 24 h) y revisar que `quickstart.md` siga al día — `docs(repo)`
- [X] T047 Despliegue: comprobar que la imagen de `analytics` con WeasyPrint se construye en el job `build` y que `analytics-worker` arranca con las dos colas en `e2e-smoke`; documentar en `docs/adr/0002-despliegue-railway.md` que no hay servicios nuevos, la variable opcional `EXPORT_TIMEOUT_S` y `FEATURE_FLAGS=exports=true` en `api` de staging — `docs(infra)`
- [X] T048 Configurar Railway **antes de fusionar**: `FEATURE_FLAGS=exports=true` en `api` de staging (conservando `insights=true` si sigue activo); producción sin cambios — `docs(infra)`
- [X] T049 Recorrer quickstart.md en staging (CSV, Excel, Gherkin y PDF de «Tienda demo», permisos y auditoría), comprobar tiempo y memoria de `analytics-worker` en Railway y registrar el resultado en `quickstart.md` — `docs(specs)`
- [X] T050 Activar `exports` por defecto (`default: true`) cuando US1–US3 y T049 estén en verde y retirarlo en un PR posterior (constitución IV) — `feat(shared)`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → historias.
- **US1**: tras la Phase 2. Aporta la vía asíncrona (`export-files`), la descarga, la caducidad y
  la interfaz web que reutilizan US2 y US3.
- **US2**: tras US1 (añade un formato a la ruta, al worker y al menú).
- **US3**: tras US1 (descarga, caducidad y menú); independiente de US2.
- **Polish**: tras las historias; T048 antes de fusionar, T049–T050 después.

### Within Each User Story

- Las pruebas se escriben primero y deben fallar antes de implementar; cada prueba va en el
  mismo commit que su implementación.
- `api`: formato → ruta → cola. `analytics`: esquemas → gráficos → PDF → worker.

### Parallel Opportunities

- Phase 2: T003, T005, T007, T009, T011 y T013 (archivos distintos).
- US1: T015–T020 en paralelo; T021 y T022 en paralelo.
- US3: T033–T038 en paralelo; el lado `analytics` (T039–T042) en paralelo con T043.
- US2 y US3 pueden avanzar en paralelo una vez terminada US1.

## Parallel Example: User Story 1

```text
T015 pruebas de CSV            T016 pruebas de Excel
T017 pruebas de integración    T018 pruebas de la vía asíncrona
T019 pruebas de caducidad      T020 pruebas de web
```

## Implementation Strategy

- **MVP**: Phases 1–3 (US1): exportación a CSV y Excel con filtros, descarga y auditoría.
- **Incremental**: US2 (Gherkin) y US3 (PDF) se integran detrás del mismo flag `exports`; cada
  historia se puede demostrar por separado y `main` queda desplegable tras cada commit.
- El flag se activa por defecto solo tras el recorrido en staging (T049–T050).
