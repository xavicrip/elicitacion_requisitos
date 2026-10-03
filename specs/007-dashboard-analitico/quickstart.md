# Quickstart: Dashboard analítico con minería de datos y de texto

Requiere 001–006, el flag `dashboard=true` (Compose lo activa) y, para el análisis, el worker de
minería: `pnpm dev:up:mining` levanta
`analysis-worker` (imagen de ~3 GB). Para los insights: `FEATURE_FLAGS=dashboard=true,insights=true`
y `ANTHROPIC_API_KEY` en `.env`. Datos: `pnpm --filter @reqcanvas/api seed:analytics` crea el
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
6. Lanzar el análisis con *Tipo = No funcional* → el resultado indica con qué filtros se
   calculó.

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

1. Crear 3 detalles nuevos → banner "Análisis desactualizado: 3 detalles nuevos".
2. *Análisis automático* → está desactivado; marcar *Analizar cada noche si hay cambios*, elegir
   la hora y guardar. A esa hora solo se lanza un análisis si los detalles cambiaron desde el
   último; cerrar el proyecto lo desprograma. El disparo se cubre con las pruebas de integración
   (`analysis-schedule`).

## 7. Gates de calidad

```bash
pnpm test:py                                                    # unitarias y contrato (sin modelos)
cd apps/analytics && uv run --group mining pytest tests/mining  # temas, duplicados y ambiguos (job analysis-eval)
pnpm e2e --project flows dashboard                              # el del análisis necesita el perfil mining
pnpm e2e:perf -g dashboard                                      # SC-001 y SC-002
```
