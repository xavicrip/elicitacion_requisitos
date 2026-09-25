# Contrato: cola `detection` (api ⇄ analytics-worker)

- **Transporte**: BullMQ sobre Redis, cola `detection`, versión de contrato `v: 1`.
- **Esquemas**: `packages/shared/src/detection.ts` (zod) y `apps/analytics/src/analytics/detection/schemas.py`
  (pydantic). Una prueba de contrato en cada lado valida los mismos ejemplos JSON
  (`apps/analytics/tests/contract/examples/*.json`).

## Entrada (`job.data`)

```json
{
  "v": 1,
  "jobId": "66f4…",
  "versionId": "66f3…",
  "image": {
    "url": "https://bucket…/display.webp?X-Amz-Signature=…",
    "width": 3200,
    "height": 2400
  },
  "options": { "llmRefine": true, "arrows": true, "languages": ["spa", "eng"] },
  "requestId": "0192…"
}
```

- `image.url`: presigned GET con validez de 10 min.

## Progreso (`job.updateProgress`)

```json
{ "stage": "ocr", "pct": 55 }
```

`stage` ∈ `download`, `shapes`, `ocr`, `arrows`, `refine`.

## Salida (`returnvalue`)

```json
{
  "v": 1,
  "activities": [
    {
      "tempId": "a1",
      "bbox": { "x": 0.12, "y": 0.30, "w": 0.15, "h": 0.06 },
      "type": "action",
      "label": "Validar pago",
      "confidence": 0.91,
      "flags": ["llm_corrected"]
    }
  ],
  "transitions": [
    { "from": "a1", "to": "a2", "confidence": 0.74 }
  ],
  "stats": { "durationMs": 18450, "llmUsed": true, "ocrMeanConfidence": 0.83 }
}
```

- `bbox` normalizado a la imagen de entrada. `tempId` es único dentro del resultado.
- `api` añade `possible_duplicate` al comparar con las actividades existentes (el worker no
  las conoce).

## Errores

El worker lanza una excepción con el código en el mensaje (`IMAGE_DOWNLOAD_FAILED`,
`NO_SHAPES_FOUND`, `TIMEOUT`, `INTERNAL`). `NO_SHAPES_FOUND` no es un fallo: se devuelve
`activities: []` y `api` muestra "No se encontraron actividades; marca las zonas manualmente".
