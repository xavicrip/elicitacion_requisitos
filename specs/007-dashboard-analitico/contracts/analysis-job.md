# Contrato: cola `analysis` (api ⇄ analytics-worker)

- **Transporte**: BullMQ, cola `analysis`, `attempts: 1` (un análisis fallido se relanza a
  mano), concurrencia 1 por réplica del worker.
- **Versión del contrato**: `v: 1`. **Esquema de resultados**: `analysis-results.schema.json` (`schemaVersion: 1`).

## Entrada (`job.data`)

```json
{
  "v": 1,
  "runId": "6700…",
  "projectId": "66f0…",
  "filters": {
    "diagramIds": null,
    "from": null,
    "to": null,
    "types": null,
    "includeStatuses": ["pending", "validated"]
  },
  "stages": ["descriptive_text", "keywords", "cooccurrence", "topics", "clusters",
             "duplicates", "sentiment", "quality", "association", "hotcold", "insights"],
  "settings": {
    "extraAmbiguousTerms": ["ágil"],
    "extraStopwords": [],
    "insightsEnabled": true,
    "rejectedInsights": ["La mayoría de requisitos son funcionales"]
  },
  "requestId": "0192…"
}
```

## Comportamiento del worker

1. `status = running`, `startedAt = now`.
2. Carga los detalles según `filters` (sin `authorId`), resuelve los duplicados confirmados
   (cuentan una vez) y excluye los `discarded` salvo que se incluyan explícitamente.
3. Si hay menos de 20 detalles: solo `keywords`, `quality`, `hotcold`; el resto se marca
   `skipped` con el motivo `INSUFFICIENT_DATA`.
4. Para cada etapa: `progress = {stage, pct}` → ejecuta → escribe `results.<etapa>` y
   `results.stages.<etapa> = {status, durationMs, error?}` con `$set` (resultados parciales
   visibles).
5. Al terminar: `status = completed` o `partial` (si alguna etapa falló), `finishedAt`.

Campos que el worker puede escribir: `status`, `progress`, `results`, `error`, `startedAt`,
`finishedAt`, `detailCount`. Cualquier otro campo es propiedad de `api`.

## Salida

El valor de retorno del job es `{ "runId": "…", "status": "completed" | "partial" | "failed" }`;
`api` lo escucha en `QueueEvents` para emitir `analysis.completed` (la 005 lo difunde a los
Admin conectados).
