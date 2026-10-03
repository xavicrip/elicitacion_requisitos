# Implementation Plan: Exportación de requisitos y reportes

**Branch**: `008-exportacion-resultados` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-exportacion-resultados/spec.md`

## Summary

Se añaden tres exportaciones para el Administrador, con los mismos filtros que el dashboard:

1. **CSV/Excel** en `api`, en streaming: `csv-stringify` con BOM UTF-8 y neutralización de
   fórmulas; `exceljs` en modo streaming.
2. **Gherkin** en español en `api`: un `.feature` por actividad, empaquetados en ZIP con
   `archiver` y validados en las pruebas con `@cucumber/gherkin`.
3. **Reporte PDF** en `analytics`: plantillas Jinja2 + **WeasyPrint**, gráficos con matplotlib
   y el diagrama con el mapa de cobertura dibujado con Pillow. Usa el último `analysis_run`
   de la 007.

Las exportaciones grandes (> 1 000 detalles) y todos los PDF se procesan en segundo plano
(cola BullMQ `export`). El archivo se sube al bucket con caducidad de 24 h y se avisa con el
evento `export:ready` de la 005 (con *polling* como alternativa). Cada exportación queda en
auditoría.

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 24 LTS (`api`, `web`); Python 3.12 (`analytics`)
**Primary Dependencies**: `api`: `csv-stringify`, `exceljs`, `archiver`, `@cucumber/gherkin` + `@cucumber/messages` (solo pruebas), `bullmq`. `analytics`: `weasyprint`, `jinja2`, `matplotlib`, `pillow`, `boto3` (subida al bucket)
**Storage**: MongoDB `exports` (propiedad de `api`; `analytics` actualiza `status` y `fileKey` de los PDF, lo que se declara compartido); bucket `exports/{projectId}/{exportId}.{ext}` con limpieza a las 24 h
**Testing**: Vitest (CSV con caracteres especiales e inyección de fórmulas, Excel leído de vuelta con exceljs, Gherkin analizado con el parser oficial, ZIP); pytest (PDF: secciones presentes con `pypdf` y datos coincidentes con el dashboard); Playwright (descargas)
**Target Platform**: Web + worker de `analytics`
**Project Type**: Aplicación web + servicio analítico
**Performance Goals**: CSV/Excel de 2 000 detalles < 10 s (SC-001); PDF de 2 000 detalles < 2 min (SC-003)
**Constraints**: solo Admin; enlaces de descarga firmados de 24 h; neutralización de `= + - @ \t \r` al inicio de celda; nombres de archivo normalizados
**Scale/Scope**: ≤ 5 000 detalles por exportación

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento | Estado |
|-----------|--------------|--------|
| I. Requisito anclado a la actividad | Todas las exportaciones agrupan o indican diagrama y actividad; Gherkin: 1 *Característica* = 1 actividad. | ✅ |
| II. Servicios desacoplados | Contrato de la cola en `contracts/export-job.md`; `exports` se declara compartida solo para los campos de resultado del PDF; `analytics` sube al bucket con credenciales limitadas al prefijo `exports/`. | ✅ (justificado abajo) |
| III. Pruebas primero | Pruebas de formato (parser Gherkin oficial, lectura de CSV/Excel, secciones del PDF) y de seguridad (fórmulas) antes de implementar. | ✅ |
| IV. Commits atómicos y reversibles | Un commit por formato; flag `export-pdf` independiente del resto; migración de índices con `down`. | ✅ |
| V. Seguridad por defecto | Neutralización de fórmulas, solo Admin, URLs firmadas de 24 h, auditoría de cada exportación. | ✅ |
| VI. Observabilidad | Estado del job, duración y tamaño del archivo en logs y en el documento `exports`. | ✅ |
| VII. Simplicidad | CSV/Excel/Gherkin síncronos en streaming por debajo de 1 000 detalles; solo el PDF usa siempre la cola. | ✅ |
| Restricciones (v1.1.0) | Node 24; Python 3.12; despliegue desde GitHub Actions (la imagen de `analytics` añade las librerías de sistema de WeasyPrint). | ✅ |

**Re-evaluación post-diseño**: sin violaciones adicionales.

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
│   └── export-job.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/exports.ts                    # ExportRequest, ExportFormat, ExportStatus
apps/api/src/modules/exports/
├── routes.ts                                     # crear (sync/async), estado, descarga
├── query.ts                                      # cursor de detalles con filtros (reutiliza los de la 007)
├── csv.ts                                        # csv-stringify + BOM + neutralización
├── xlsx.ts                                       # exceljs WorkbookWriter (streaming)
├── gherkin.ts                                    # render .feature + zip (archiver)
├── sanitize.ts                                   # neutralizeFormula, safeFileName
├── queue.ts                                      # cola "export" (grandes + PDF) + limpieza cada hora
└── models/export.ts
apps/api/migrations/20261105000000-exports-indexes.js
apps/analytics/src/analytics/reports/
├── pdf.py                                        # job "export" (format=pdf)
├── charts.py                                     # matplotlib → SVG
├── coverage_image.py                             # Pillow: diagrama + colores de cobertura
└── templates/{report.html.j2,report.css}
apps/web/src/features/exports/
├── ExportMenu.tsx                                # en el dashboard y en la lista de requisitos
└── ExportsList.tsx                               # historial con estado y enlaces de 24 h
e2e/exports.spec.ts
```

**Structure Decision**: los formatos tabulares y de texto en `api` (Node, streaming, sin
dependencias pesadas) y el PDF en `analytics`, donde ya están los resultados del análisis y el
ecosistema de gráficos de Python.

## Ajustes tras implementar la 002–007 (2026-10-03)

El plan original es anterior a la implementación de las features 002–007. Estos ajustes
**prevalecen** sobre lo escrito más arriba y sobre `research.md` cuando difieran.

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
   proceso pasa a consumir dos colas (`detection` y `export`) sobre `queue_worker.py`; su latido
   y el check `detection-worker` de `/health/deep` cubren ambas. La imagen añade las librerías
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
17. **Despliegue**: sin servicios ni variables obligatorias nuevas en Railway
    (`EXPORT_TIMEOUT_S` es opcional); `api` de staging recibe `FEATURE_FLAGS=exports=true`.

## Complexity Tracking

Sin violaciones: con el ajuste 1, `exports` es propiedad exclusiva de `api` y el worker solo
usa URLs firmadas.
