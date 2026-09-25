# Contrato: cola `export`

- **Transporte**: BullMQ, cola `export`, `attempts: 2`. Nombre del job = formato.
- **Consumidores**: el worker **Node** de `api` procesa `csv`, `xlsx` y `gherkin` (filtro por
  nombre); el worker **Python** de `analytics` procesa `pdf`.

## Entrada (`job.data`)

```json
{
  "v": 1,
  "exportId": "6710…",
  "projectId": "66f0…",
  "format": "pdf",
  "filters": { "diagramIds": null, "from": null, "to": null, "types": null, "includeStatuses": ["validated", "pending"] },
  "options": {},
  "analysisRunId": "6700…",
  "kpiSnapshot": { "totalDetails": 80, "activeParticipants": 6, "coveredActivitiesPct": 70.0, "validatedPct": 45.0 },
  "timezone": "America/Guayaquil",
  "requestId": "0192…"
}
```

## Comportamiento

1. `status = running`.
2. Genera el archivo en un temporal y lo sube a `exports/{projectId}/{exportId}.{ext}`
   (`ContentDisposition: attachment; filename="…"`).
3. `status = ready`, `fileKey`, `bytes`, `readyAt`, `expiresAt = readyAt + 24 h`.
4. Valor de retorno: `{ exportId, status }`. `api` (QueueEvents) emite `export:ready` a
   `user:{requestedBy}`.

Errores: `status = failed` y `error = {code: 'EXPORT_FAILED' | 'NO_DATA' | 'TIMEOUT', message}`.
`NO_DATA` no es un fallo para CSV/Excel (se genera el archivo con solo encabezados, según el
edge case); sí lo es para el PDF si no hay diagramas publicados.
