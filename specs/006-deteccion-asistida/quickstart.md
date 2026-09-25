# Quickstart: Detección asistida de actividades en la imagen

Requiere 001–003, el flag `detection=true` y el worker en marcha
(`pnpm dev:up` incluye `analytics-worker`). Para probar el refinamiento con LLM:
`detection-llm=true` y `ANTHROPIC_API_KEY` en `.env`.

## 1. Detección (US1)

1. Subir `apps/analytics/tests/fixtures/diagrams/001.png` (15 actividades, PlantUML) como
   diagrama nuevo → *Detectar actividades*.
2. Se ve el progreso por etapas (descarga → formas → OCR → flechas) y se puede navegar
   mientras tanto.
3. Al terminar (< 60 s, SC-003): zonas punteadas con nombre, tipo y confianza.
4. Subir una foto sin diagrama → mensaje "No se encontraron actividades…".
5. Detener `analytics-worker` y lanzar una detección → tras el timeout, error claro y botón
   *Reintentar*.

## 2. Revisión (US2)

1. *Aceptar todas las de confianza alta* → se crean como actividades normales.
2. Corregir el nombre de una propuesta media y aceptarla; descartar una baja.
3. Intentar publicar con propuestas pendientes → bloqueado, con el conteo.
4. Volver a ejecutar la detección → las actividades aceptadas no cambian; las propuestas que se
   superponen aparecen como "posible duplicado".

## 3. Transiciones (US3)

1. En `004.png` (flujo lineal de 5 actividades), tras aceptar las actividades → 4 transiciones
   propuestas; aceptarlas → flechas en el editor.

## 4. Evaluación (SC-001, SC-002, SC-004)

```bash
cd apps/analytics
uv run python tests/eval/evaluate_detection.py --subset digital
# Zonas recall ≥ 0.85 · Etiquetas exactas ≥ 0.80
uv run python tests/eval/evaluate_detection.py --subset digital --llm   # manual, con coste
```

SC-004: cronometrar la preparación de un diagrama de 20 actividades con detección y sin ella
(003) y comparar.

## 5. Pruebas

```bash
cd apps/analytics && uv run pytest tests/unit tests/contract
pnpm --filter api test -- detection
pnpm e2e -- detection-review
```
