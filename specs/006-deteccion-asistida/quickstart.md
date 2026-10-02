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

## Recorrido en staging (T051, 2026-10-02)

Sobre `aca929a` (flag `detection` activado solo en staging), por la API pública de staging con una
cuenta nueva (`recorrido-006-…@example.com`) y un proyecto abierto. La interfaz no se recorrió en
staging: la cubren los E2E contra Compose (`e2e/flows/detection.spec.ts`).

| Paso | Resultado |
| --- | --- |
| §1 `compra-simple.png` | `done` en 2,5 s de punta a punta (0,8 s en el worker): 6 zonas de confianza alta con su nombre y 5 flechas |
| §2 Publicar con propuestas pendientes | `422` |
| §2 Aceptar en bloque | 6 aceptadas, todas con `source: detected` |
| §3 Aceptar las flechas | 5 aceptadas → 5 transiciones en el editor |
| §2 Publicar ya revisado | `200`; volver a detectar sobre la versión publicada → `409` |
| SC-003 `020.png` (50 actividades) | `done` en 8,6 s de punta a punta (6,8 s en el worker): 50 zonas y 54 flechas |

`analytics-worker` en staging (métricas de Railway, promedio por minuto): 111 MB en reposo y
161 MB de pico durante las detecciones, con CPU de 0,18 vCPU como máximo. El límite del servicio
es de 24 GB y 24 vCPU: la cuenta no está en el plan Free de 0,5 GB que temía el plan (ajuste 9).
`api /health/deep` incluye `detection-worker: up`.

SC-004 (preparar un diagrama de 20 actividades con y sin detección) no se cronometró con una
persona: con detección, la parte automática son unos 3 s más la revisión (aceptar en bloque y
corregir lo que haga falta), frente a marcar las 20 zonas una a una en el editor de la 003. Queda
pendiente medirlo en una sesión real.

- El proyecto y la cuenta de prueba se quedan en staging: no hay borrado de cuentas.

## 5. Pruebas

```bash
pnpm test:services:up
pnpm test:py                                                    # unit, contrato y gate
pnpm --filter @reqcanvas/api exec vitest run detection proposals transition-proposals publish-guards storage-presign
pnpm dev:up && pnpm e2e --project flows detection
pnpm e2e:perf -g "50 actividades"                               # < 60 s y worker < 400 MB
```
