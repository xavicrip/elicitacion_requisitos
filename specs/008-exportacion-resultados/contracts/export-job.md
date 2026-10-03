# Contrato: cola `export` (reporte PDF)

- **Transporte**: BullMQ, cola `export`, `attempts: 1`, `jobId = exportId`.
- **Productor**: `api`. **Consumidor**: `analytics-worker` (Python), que no accede a MongoDB ni
  tiene credenciales del bucket: solo usa las URLs firmadas del job.
- **Versión**: 1. Esquemas en `packages/shared/src/exports.ts` (zod) y
  `apps/analytics/src/analytics/reports/schemas.py` (pydantic), validados en ambos lados con
  los mismos ejemplos (`apps/analytics/tests/contract/examples/export/`).

CSV, Excel y Gherkin no usan esta cola: los genera `api` (cola interna `export-files` cuando
superan los 1 000 detalles).

## Entrada (`job.data`)

```json
{
  "v": 1,
  "exportId": "6710…",
  "projectId": "66f0…",
  "inputUrl": "https://…/projects/66f0…/exports/6710…/input.json.gz?X-Amz-…",
  "outputUrl": "https://…/projects/66f0…/exports/6710….pdf?X-Amz-…",
  "requestId": "0192…"
}
```

## Archivo de entrada (`input.json.gz`)

```json
{
  "schemaVersion": 1,
  "project": { "name": "Tienda demo", "timezone": "America/Guayaquil" },
  "generatedAt": "2026-10-03T15:00:00.000Z",
  "filters": { "diagramIds": null, "from": null, "to": null, "types": null, "statuses": ["pending", "validated"] },
  "descriptive": { "kpis": { "totalDetails": 80, "activeParticipants": 6, "coveredActivitiesPct": 90, "validatedPct": 15 }, "byActivity": [], "byType": [], "byPriority": [], "byRole": [], "byStatus": [], "timeline": [] },
  "diagrams": [
    {
      "id": "66f1…", "name": "Proceso de compra",
      "image": { "url": "https://…", "width": 1600, "height": 900 },
      "activities": [{ "key": "…", "label": "Validar pago", "bbox": { "x": 10, "y": 20, "w": 120, "h": 60 }, "detailCount": 20 }]
    }
  ],
  "details": [
    { "id": "…", "diagramId": "66f1…", "activityKey": "…", "given": "…", "when": "…", "then": "…", "type": "functional", "priority": "must", "authorRole": "Cajero", "tags": ["pagos"], "status": "validated", "voteCount": 3, "commentCount": 1, "createdAt": "…" }
  ],
  "analysis": null
}
```

Los detalles no llevan nombres ni identificadores de personas (sí el rol declarado).
`descriptive` es el `DescriptiveDashboard` de la 007 calculado con los mismos filtros (SC-004).
`analysis` es `null` si no hay un análisis terminado; si lo hay, `{ finishedAt, stages, results }`
con los `AnalysisResults` de la 007 ya filtrados (sin pares de duplicados decididos ni insights
marcados como no útiles).

## Valor de retorno

```json
{ "v": 1, "status": "done", "bytes": 482133, "pages": 14 }
```

o, si falla, `{ "v": 1, "status": "failed", "error": { "code": "EXPORT_FAILED", "message": "…" } }`.
Códigos: `INPUT_DOWNLOAD_FAILED`, `OUTPUT_UPLOAD_FAILED`, `EXPORT_FAILED`, `TIMEOUT`.

## Comportamiento

1. `api` crea el documento `exports` (`pending`), escribe `input.json.gz` y encola el job.
2. El worker descarga la entrada, descarga las imágenes de los diagramas, genera el PDF en un
   temporal y lo sube con `PUT` a `outputUrl` (`Content-Type: application/pdf`).
3. `api` (QueueEvents) valida el retorno, guarda `status`, `bytes`, `finishedAt` y `expiresAt`,
   y borra `input.json.gz`. Si el worker no responde antes de `EXPORT_TIMEOUT_S`, o no hay
   ningún worker vivo al encolar, la exportación queda `failed` (`TIMEOUT`,
   `WORKER_UNAVAILABLE`).

Un proyecto sin diagramas publicados se rechaza antes de encolar (422 `NO_DIAGRAMS`).
