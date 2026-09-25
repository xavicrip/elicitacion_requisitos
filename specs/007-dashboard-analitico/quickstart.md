# Quickstart: Dashboard analítico con minería de datos y de texto

Requiere 001–004, el worker de `analytics` (`pnpm dev:up`) y los flags `analytics-text=true` e
`insights=true` (con `ANTHROPIC_API_KEY`). Datos: `pnpm --filter api seed:analytics` crea el
proyecto "Tienda demo" (10 actividades, 80 detalles, 6 participantes) con 3 temas conocidos
(pagos, notificaciones, seguridad), 5 detalles ambiguos y 3 pares de duplicados.

## 1. Descriptivo (US1)

1. Como Admin, *Dashboard* → KPIs, distribuciones y línea de tiempo en < 3 s (SC-001);
   comprobar los totales con `seed:analytics --print-expected`.
2. Filtrar por *Tipo = No funcional* y por un rango de fechas → todo se recalcula.
3. Clic en una actividad del mapa de cobertura → sus indicadores y un enlace a sus requisitos.
4. Como Participante, abrir `/proyectos/:id/dashboard` → acceso denegado.

## 2. Análisis de texto (US2)

1. *Ejecutar análisis* → barra de progreso por etapa; al terminar, fecha del análisis.
2. *Palabras clave* de "Validar pago" → términos como "tarjeta", "pago", "confirmación".
3. *Temas* → aparecen los 3 temas sembrados como temas distintos.
4. *Grupos* → dispersión 2D; clic en un grupo → sus detalles.
5. En un proyecto con 10 detalles → aviso "Datos insuficientes" y solo lo descriptivo.

## 3. Calidad y duplicados (US3)

1. *Calidad* ordenada por puntaje → los 5 ambiguos aparecen arriba, con el término resaltado y
   la sugerencia.
2. *Posibles duplicados* → los 3 pares con su % de similitud; confirmar uno → el detalle queda
   *Duplicado* (visible en el canvas); rechazar otro → no vuelve a aparecer al re-ejecutar.

## 4. Patrones (US4)

*Sentimiento*, *Reglas de asociación* (con frase explicativa) y *Actividades críticas*
(calientes y frías con motivo).

## 5. Insights (US5)

1. *Generar resumen* → 3–10 insights; clic en uno → panel de evidencias con los datos.
2. Marcar uno como "no útil" → se oculta; al regenerar, no se repite.
3. Quitar `ANTHROPIC_API_KEY` y regenerar → aviso "Resumen no disponible"; el resto del
   dashboard funciona.

## 6. Obsolescencia y programación

Crear 3 detalles nuevos → banner "Análisis desactualizado: 3 detalles nuevos". El job
nocturno se prueba con `pnpm --filter api analysis:schedule --run-now`.

## 7. Gates de calidad

```bash
cd apps/analytics
uv run pytest tests/unit tests/contract
uv run pytest tests/eval/test_quality_gates.py   # duplicados recall ≥ 0.80 y FP < 0.20; ambiguos ≥ 0.80
uv run python -m analytics.mining.run --bench 2000   # < 5 min (SC-002)
pnpm e2e -- dashboard-descriptive dashboard-analysis
```
