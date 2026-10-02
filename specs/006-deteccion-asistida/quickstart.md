# Quickstart: Detección asistida de actividades en la imagen

Requiere 001–005, el flag `detection=true` (Compose lo activa) y el worker en marcha
(`pnpm dev:up` incluye `analytics-worker`). Para probar el refinamiento con Claude:
`FEATURE_FLAGS=detection=true,detection-llm=true` y `ANTHROPIC_API_KEY` en `.env`. El conjunto de
validación se genera con `uv run --directory apps/analytics python tests/fixtures/generate.py`.

## 1. Detección (US1)

1. Subir `e2e/fixtures/diagrams/compra-simple.png` (6 actividades) o un diagrama de 15
   actividades del conjunto de validación como diagrama nuevo → *Detectar actividades*.
2. Se ve el progreso por etapas (descarga → formas → OCR → flechas), en tiempo real por el
   socket de la 005 o consultando cada 3 s sin conexión, y se puede navegar mientras tanto.
3. Al terminar (< 60 s, SC-003): zonas punteadas con nombre, tipo y confianza.
4. Subir una foto sin diagrama → mensaje «No se encontraron actividades; marca las zonas
   manualmente.».
5. Detener `analytics-worker` y lanzar una detección → tras el timeout, error claro y botón
   *Reintentar*.

## 2. Revisión (US2)

1. *Aceptar todas las de confianza alta* → se crean como actividades normales (no incluye los
   posibles duplicados ni las acciones sin nombre). Un inicio, fin o decisión sin nombre se
   acepta como «Inicio», «Fin» o «Decisión».
2. Corregir el nombre o el tipo de una propuesta media y aceptarla; descartar una baja (también
   se descartan las flechas que la tocaban). La zona se ajusta después con el editor de la 003.
3. Intentar publicar con propuestas pendientes → bloqueado, con el conteo.
4. Volver a ejecutar la detección → las actividades aceptadas no cambian; las propuestas que se
   superponen aparecen como "posible duplicado".

## 3. Transiciones (US3)

1. En `004.png` (flujo lineal de 5 actividades) → 4 flechas propuestas, discontinuas, y el
   apartado *Flechas propuestas (4)*; *Aceptar* se habilita al aceptar sus dos actividades →
   transiciones en el editor.

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
pnpm test:services:up
pnpm test:py                                                    # unit, contrato y gate
pnpm --filter @reqcanvas/api exec vitest run detection proposals transition-proposals publish-guards storage-presign
pnpm dev:up && pnpm e2e --project flows detection
pnpm e2e:perf -g "50 actividades"                               # < 60 s y worker < 400 MB
```
