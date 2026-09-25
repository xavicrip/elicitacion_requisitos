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

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `exports` actualizada por `analytics` (campos `status`, `fileKey`, `bytes`, `error` de los PDF) | El PDF se genera en el worker de `analytics` y su estado debe consultarse desde `api` | Devolverlo por el valor de retorno del job y que `api` lo persista (como en la 006) también es posible; se elige la escritura directa por coherencia con `analysis_runs` (007). **Alternativa aceptable**: si en la revisión se prefiere la propiedad única, se cambia a QueueEvents sin modificar el contrato REST. |
