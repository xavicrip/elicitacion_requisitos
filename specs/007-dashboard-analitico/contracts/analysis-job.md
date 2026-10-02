# Contrato: cola `analysis` (api ⇄ analysis-worker)

- **Transporte**: BullMQ, cola `analysis`, prefijo `bull` (como la `detection` de la 006),
  `attempts: 1` (un análisis fallido se relanza a mano), concurrencia 1 por réplica del worker y
  límite de `ANALYSIS_TIMEOUT_S` (900 s por defecto).
- **Versión del contrato**: `v: 1`. **Esquema de resultados**: `analysis-results.schema.json`
  (`schemaVersion: 1`). Esquemas en `packages/shared/src/analytics.ts` (zod) y
  `apps/analytics/src/analytics/mining/schemas.py` (pydantic), probados sobre los mismos ejemplos.
- **Sin MongoDB en el worker** (plan, ajuste 1): la entrada y los resultados viajan por el bucket
  con URLs firmadas de 15 minutos.

## Entrada (`job.data`)

```json
{
  "v": 1,
  "runId": "6700…",
  "projectId": "66f0…",
  "kind": "full",
  "inputUrl": "https://…/projects/66f0…/analysis/6700…/input.json.gz?X-Amz-…",
  "resultsUrl": "https://…/projects/66f0…/analysis/6700…/results.json.gz?X-Amz-…",
  "previousResultsUrl": null,
  "stages": ["keywords", "cooccurrence", "topics", "clusters", "duplicates", "sentiment",
             "quality", "association", "hotcold", "insights"],
  "settings": {
    "extraAmbiguousTerms": ["ágil"],
    "extraStopwords": [],
    "insightsEnabled": true,
    "rejectedInsights": ["La mayoría de requisitos son funcionales"]
  },
  "requestId": "0192…"
}
```

- `kind: "insights"` regenera solo esa etapa: `stages` es `["insights"]` y `previousResultsUrl`
  apunta a los resultados del run original.
- `insightsEnabled` es `false` sin el flag `insights`; la etapa queda `skipped`.

### Archivo de entrada (`input.json.gz`, JSON con gzip)

```json
{
  "v": 1,
  "projectId": "66f0…",
  "filters": { "diagramIds": null, "from": null, "to": null, "types": null,
               "statuses": ["pending", "validated"] },
  "activities": [{ "key": "c0a8…", "diagramId": "66f1…", "label": "Validar pago" }],
  "details": [{
    "id": "66f2…", "diagramId": "66f1…", "activityKey": "c0a8…",
    "given": "…", "when": "…", "then": "…",
    "type": "non_functional", "priority": "must", "authorRole": "Cajero",
    "tags": ["pagos"], "status": "pending", "voteCount": 3, "commentCount": 1,
    "createdAt": "2026-10-01T15:00:00.000Z"
  }],
  "duplicateDecisions": [{ "pair": ["66f2…", "66f3…"], "decision": "rejected" }]
}
```

Sin `authorId`, nombres ni emails. Los detalles `duplicate` ya confirmados no se exportan (cuentan
una vez a través de su original) y los `discarded` solo si el filtro los incluye.

## Comportamiento del worker

1. Descarga y descomprime la entrada (y los resultados anteriores si `kind` es `insights`).
2. Con menos de 20 detalles: solo `keywords`, `quality` y `hotcold`; el resto queda `skipped` con
   `reason: "INSUFFICIENT_DATA"`.
3. Para cada etapa: informa `progress = {stage, pct}` → ejecuta → guarda su resultado y
   `stages.<etapa> = {status, durationMs, error?}`. Una etapa que falla no detiene las demás.
4. Sube `results.json.gz` (`AnalysisResults`, `content-type: application/gzip`) a `resultsUrl`.
5. Escribe un latido en Redis cada 10 s (`analysis:worker:{id}`, TTL 30 s) y expone `GET /health`,
   como el worker de la 006. Cada línea de log lleva el `requestId` del job.

## Salida (valor de retorno del job)

```json
{ "v": 1, "status": "done", "partial": false, "detailCount": 80,
  "stages": { "keywords": { "status": "done", "durationMs": 812 },
              "insights": { "status": "skipped", "reason": "NO_API_KEY" } } }
```

`status` es `done` o `failed` (entrada ilegible, `v` desconocido, error al subir); con `failed`,
`error: { code }`. `api` escucha `QueueEvents`, descarga y valida `results.json.gz` y actualiza el
run; un resultado inválido o el timeout lo dejan `failed` con un mensaje en español.
