# Implementation Plan: Exportación de requisitos y reportes

**Branch**: `008-exportacion-resultados` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-exportacion-resultados/spec.md`

## Summary

Se añaden tres exportaciones para el Administrador, con los mismos filtros que el dashboard:

1. **CSV/Excel** en `api`, en streaming: `csv-stringify` con BOM UTF-8 y neutralización de
   fórmulas; `exceljs` en modo streaming.
2. **Gherkin** en español en `api`: un `.feature` por actividad, empaquetados en ZIP con
   `archiver` y validados en las pruebas con `@cucumber/gherkin`.
3. **Reporte PDF** en `analytics-worker`: plantillas Jinja2 + **WeasyPrint**, gráficos de barras
   en SVG y el diagrama con el mapa de cobertura dibujado con Pillow. Usa la instantánea
   descriptiva y el último análisis terminado de la 007, que `api` le entrega en un archivo.

Los CSV, Excel y Gherkin de más de 1 000 detalles y todos los PDF se generan en segundo plano
(colas BullMQ `export-files`, en `api`, y `export`, en Python). El archivo queda en el bucket
24 h, la web consulta el estado cada 3 s y avisa cuando está listo, y la descarga pasa por
`api`. Cada exportación y cada descarga quedan en auditoría.

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 24 LTS (`api`, `web`); Python 3.12 (`analytics`)
**Primary Dependencies**: `api`: `csv-stringify`, `exceljs`, `archiver`, `bullmq`; solo en pruebas `@cucumber/gherkin`, `@cucumber/messages` y `yauzl`. `analytics`: `weasyprint`, `jinja2`, `pillow`; solo en pruebas `pypdf`
**Storage**: MongoDB `exports` (propiedad exclusiva de `api`); bucket `projects/{projectId}/exports/{exportId}.{ext}` con limpieza horaria a las 24 h
**Testing**: Vitest (CSV con caracteres especiales e inyección de fórmulas, Excel leído de vuelta con exceljs, Gherkin analizado con el parser oficial, ZIP, worker falso para el PDF); pytest (PDF: secciones presentes con `pypdf` y datos coincidentes con la entrada); Playwright (descargas)
**Target Platform**: Web + `analytics-worker`
**Project Type**: Aplicación web + servicio analítico
**Performance Goals**: CSV/Excel de 2 000 detalles < 10 s (SC-001); PDF de 2 000 detalles < 2 min (SC-003)
**Constraints**: solo Admin; archivos disponibles 24 h; neutralización de `= + - @ \t \r` al inicio de celda; nombres de archivo normalizados; una exportación en curso por proyecto y formato
**Scale/Scope**: ≤ 5 000 detalles por exportación

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento | Estado |
|-----------|--------------|--------|
| I. Requisito anclado a la actividad | Todas las exportaciones agrupan o indican diagrama y actividad; Gherkin: 1 *Característica* = 1 actividad. | ✅ |
| II. Servicios desacoplados | `exports` es propiedad exclusiva de `api`. El worker del PDF no accede a MongoDB ni tiene credenciales del bucket: recibe URLs firmadas y devuelve un resumen. Contrato de la cola en `contracts/export-job.md`, validado en ambos lados. | ✅ |
| III. Pruebas primero | Pruebas de formato (parser Gherkin oficial, lectura de CSV/Excel, secciones del PDF), de seguridad (fórmulas, permisos) y de contrato de cada ruta antes de implementar. | ✅ |
| IV. Commits atómicos y reversibles | Un commit por formato; flag `exports` hasta completar la feature; migración de índices con `down`. | ✅ |
| V. Seguridad por defecto | Neutralización de fórmulas, solo Admin, descarga autenticada a través de `api`, caducidad de 24 h, una exportación en curso por proyecto y formato, auditoría de cada exportación y descarga. | ✅ |
| VI. Observabilidad | Estados `pending`, `running`, `done` y `failed`; duración y tamaño del archivo en los logs y en el documento `exports`; latido del worker en `/health/deep`. | ✅ |
| VII. Simplicidad | CSV/Excel/Gherkin síncronos en streaming por debajo de 1 000 detalles; sin servicio nuevo ni matplotlib; aviso por consulta periódica. | ✅ |
| Restricciones (v1.1.0) | Node 24; Python 3.12; despliegue desde GitHub Actions (la imagen de `analytics` añade las librerías de sistema de WeasyPrint). | ✅ |

**Re-evaluación post-diseño**: sin violaciones.

## Project Structure

### Documentation (this feature)

```text
specs/008-exportacion-resultados/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── exports.openapi.yaml
│   ├── export-formats.md       # Columnas CSV/Excel, plantilla Gherkin, secciones del PDF
│   └── export-job.md           # Cola `export` (PDF) y archivo de entrada
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/exports.ts                    # ExportRequest, Export, contrato del job del PDF
apps/api/src/modules/exports/
├── routes.ts                                     # crear (sync/async), historial, estado, descarga
├── service.ts                                    # create, toDto, list, get
├── query.ts                                      # cursor de detalles con los filtros de la 007
├── columns.ts                                    # las 18 columnas de CSV y Excel
├── csv.ts                                        # csv-stringify + BOM + neutralización
├── xlsx.ts                                       # exceljs WorkbookWriter (streaming)
├── gherkin.ts                                    # render .feature + zip (archiver)
├── sanitize.ts                                   # neutralizeFormula, safeFileName
├── report-input.ts                               # archivo de entrada del PDF
├── cascade.ts
└── models/export.ts
apps/api/src/jobs/export-files.ts                 # cola interna (CSV/Excel/Gherkin grandes) + limpieza horaria
apps/api/src/jobs/export-pdf.ts                   # cola `export` hacia analytics-worker
apps/api/migrations/20261105000000-exports-indexes.js
apps/analytics/src/analytics/reports/
├── schemas.py                                    # contrato v1 (pydantic)
├── worker.py                                     # consumidor de la cola `export`
├── pdf.py                                        # Jinja2 + WeasyPrint
├── charts.py                                     # barras en SVG
├── coverage_image.py                             # Pillow: diagrama + colores de cobertura
└── templates/{report.html.j2,report.css}
apps/web/src/features/exports/
├── ExportMenu.tsx                                # en el dashboard (Administrador)
├── ExportsList.tsx                               # historial con estado y descarga
├── useExport.ts                                  # solicitud, consulta cada 3 s y descarga
└── api.ts
e2e/flows/exports.spec.ts
e2e/perf/exports.perf.spec.ts
```

**Structure Decision**: los formatos tabulares y de texto en `api` (Node, streaming, sin
dependencias pesadas) y el PDF en `analytics-worker`, que ya consume colas de BullMQ y tiene el
ecosistema de Python para componer el documento.

## Ajustes tras implementar la 002–007 (2026-10-03)

El plan original es anterior a la implementación de las features 002–007. Las secciones
anteriores y `research.md` ya recogen estos ajustes; se conservan aquí como registro de lo que
cambió y por qué.

1. **El worker del PDF no accede a MongoDB ni tiene credenciales del bucket (constitución II,
   como la 006 y la 007)**. `api` prepara la entrada del reporte en un JSON comprimido en el
   bucket (`projects/{projectId}/exports/{exportId}/input.json.gz`: detalles filtrados con el
   nombre del autor, diagramas publicados con sus actividades y una URL firmada de su imagen,
   la instantánea descriptiva y los resultados del último análisis) y encola el job con una URL
   firmada de lectura y otra de escritura (`presignGet` y `presignPut`, 15 min). El worker sube
   el PDF a `projects/{projectId}/exports/{exportId}.pdf` y devuelve solo un resumen (`status`,
   `bytes`, `pages`). `api` es la única que escribe `exports`. Desaparecen `boto3` y la colección
   compartida (ver *Complexity Tracking*).
2. **Estados de la constitución VI**: `pending`, `running`, `done` y `failed`. La caducidad no es
   un estado: es `expiresAt` (24 h después de terminar); el DTO añade `expired: boolean` y, tras
   la limpieza, `fileKey` queda vacío.
3. **Filtros de la 007**: `DashboardFiltersSchema` de `packages/shared` (`diagramIds`, `from`,
   `to`, `types`, `statuses`) y `apps/api/src/modules/dashboard/filters.ts`. El menú *Exportar*
   del dashboard usa los filtros activos. En Gherkin los estados no salen del filtro: solo
   `validated`, o `validated` y `pending` con `includePending`.
4. **Dos colas, como la 006 y la 007**:
   - `export-files` (CSV, Excel y Gherkin de más de 1 000 detalles): la consume un `Worker` de
     BullMQ dentro de `api` (`apps/api/src/jobs/export-files.ts`, patrón de
     `project-deletion.ts`), que genera el archivo en streaming y lo sube al bucket.
   - `export` (PDF): la consume Python. Contrato versión 1 en `packages/shared` (zod) y en
     `analytics` (pydantic), con la prueba de contrato en ambos lados sobre los mismos ejemplos;
     `attempts: 1` y `EXPORT_TIMEOUT_S=300`.
5. **Sin servicio nuevo**: el PDF lo genera `analytics-worker` (la imagen de `analytics`), cuyo
   proceso pasa a consumir dos colas (`detection` y `export`) sobre `queue_worker.py`. Cada cola
   tiene su latido en Redis: `api` comprueba el de `export` antes de encolar un PDF
   (`WORKER_UNAVAILABLE`) y `/health/deep` añade el check `export-worker` con el flag activo. La imagen añade las librerías
   de sistema de WeasyPrint (Pango) y una fuente.
6. **Sin matplotlib**: los gráficos del reporte son barras en SVG generadas en la plantilla
   (WeasyPrint incrusta SVG), con la paleta del dashboard. Dependencias nuevas de `analytics`:
   `weasyprint`, `jinja2` y `pillow`; `pypdf` solo en pruebas.
7. **Aviso sin socket**: las salas de la 005 son del espacio de trabajo de un diagrama. Como en
   la 007, la web consulta `GET /exports/:id` cada 3 s mientras la exportación está `pending` o
   `running` y avisa «Tu exportación está lista». No se añade `export:ready`.
8. **Descarga a través de `api`**: `GET /exports/:id/download` sirve el archivo en streaming
   desde el bucket (como las imágenes de la 003), con `Content-Disposition`; el bucket no es
   accesible desde el navegador en Compose. Responde 409 si no está lista y 410 si caducó, y
   registra `export.downloaded`. Las exportaciones síncronas (≤ 1 000 detalles) responden el
   archivo directamente y no se guardan en el bucket.
9. **Auditoría existente**: `auditService` (`apps/api/src/modules/audit`) con las acciones
   `export.requested` (`{format, filters, options, count}`) y `export.downloaded`.
10. **Un solo flag**: `exports` (por defecto `false`; Compose y el CI lo activan), con sus rutas
    en `GATED_PREFIXES` y el menú en `web` detrás de `FlagGate`. No hay `export-pdf`: el PDF es
    la última historia y entra detrás del mismo flag.
11. **Limpieza**: un `JobScheduler` de BullMQ en `api` (cada hora, como la programación de la
    007) borra del bucket los archivos caducados y vacía `fileKey`. Los archivos viven bajo el
    prefijo del proyecto, así que la cascada de borrado de la 003 también los elimina; se
    registra además la cascada de `exports` (`registerExportsCascade`). Sin regla de ciclo de
    vida en el bucket.
12. **Coherencia con el dashboard (SC-004)**: la instantánea del PDF la calcula
    `descriptive.service` de la 007 con los mismos filtros en el momento de la solicitud, y los
    hallazgos salen de `analysis.service` (`toFullDto` del último análisis terminado: sin los
    pares de duplicados ya decididos ni los insights marcados como no útiles). Sin análisis, o
    con etapas omitidas o fallidas, la sección lo indica.
13. **Zona horaria**: la del proyecto (`analysis_settings.schedule.timezone`, por defecto
    `America/Guayaquil`), como la serie temporal de la 007.
14. **Web**: `apps/web/src/features/exports/` con `ExportMenu` (en la página del dashboard, solo
    Administrador) y `ExportsList` (historial con estado y descarga). Las descargas usan
    `fetch` con la sesión y un `Blob`. E2E en `e2e/flows/exports.spec.ts`.
15. **Migración**: `20261105000000-exports-indexes.js` (posterior a la de la 007).
16. **Volumen para las mediciones**: `e2e/perf/exports.perf.spec.ts` reutiliza la inserción con
    `mongosh` de la medición del dashboard (se extrae a `e2e/perf/volume.ts`); no hay
    `seed:bulk` ni `exports:expire` (la caducidad se prueba en integración).
17. **Una exportación en curso por proyecto y formato**: solicitar otra del mismo formato
    mientras hay una `pending` o `running` responde 409 `EXPORT_IN_PROGRESS` (como
    `ANALYSIS_IN_PROGRESS` en la 007). Un proyecto sin detalles exporta CSV y Excel con solo los
    encabezados y un PDF con las secciones vacías indicadas; la respuesta lleva
    `X-Export-Empty: true` (o `detailCount: 0`) y la web muestra «No hay requisitos con estos
    filtros».
18. **El autor no viaja al worker**: el anexo del PDF no imprime el autor (sí el rol), así que
    el archivo de entrada no lleva nombres ni identificadores de personas, como en la 007.
19. **Despliegue**: sin servicios ni variables obligatorias nuevas en Railway
    (`EXPORT_TIMEOUT_S` es opcional); `api` de staging recibe `FEATURE_FLAGS=exports=true`.

20. **Mediciones (T045, 2026-10-03)**: `e2e/perf/exports.perf.spec.ts` contra Compose en local.
    Con 2 000 detalles: CSV 0,2 s, Excel 0,8 s, Gherkin 0,2 s y PDF 7,4 s (596 KB), con
    `analytics-worker` entre 186 MB y 343 MB (SC-001 y SC-003 cumplidos). Con 5 000: CSV 0,6 s,
    Excel 1,5 s, Gherkin 0,2 s y PDF 25,1 s (1,1 MB), con un pico de 685 MB. Detalle en el
    ADR 0010.
21. **Detalles del reporte PDF**: usa los mismos detalles que cuenta el dashboard con esos
    filtros (`detailsQuery` de la 007, sin los duplicados confirmados), para que el anexo y los
    indicadores sean coherentes; CSV y Excel sí exportan los duplicados si el filtro los pide.
    El filtro de diagramas también limita los diagramas del reporte, y `NO_DIAGRAMS` se responde
    cuando no queda ninguno publicado. WeasyPrint solo puede leer recursos incrustados
    (`data:`): las imágenes las descarga el worker por su URL firmada.

## Complexity Tracking

Sin violaciones: con el ajuste 1, `exports` es propiedad exclusiva de `api` y el worker solo
usa URLs firmadas.
