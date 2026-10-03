# Quickstart: Dashboard analítico con minería de datos y de texto

Requiere 001–006 (el flag `dashboard` ya se retiró) y, para el análisis, el worker de
minería: `pnpm dev:up:mining` levanta
`analysis-worker` (imagen de ~3 GB). Para los insights: `FEATURE_FLAGS=insights=true`
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
pnpm e2e --project=flows dashboard                             # el del análisis necesita el perfil mining
pnpm e2e:perf -g dashboard                                      # SC-001 y SC-002
```

## 8. Recorrido en staging (2026-10-03)

Versión `v0.7.0-56-gdcdb5ea`, con `FEATURE_FLAGS=dashboard=true` en `api` y `analysis-worker`
desplegado (primer build de la imagen de minería en Railway dentro del margen del despliegue).
Hecho **por la API pública**, con el proyecto «Tienda demo» creado por `seed:analytics`.

| Paso                         | Resultado                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `/health/deep`               | `ok`, con `analysis-worker` arriba                                                           |
| Descriptivo (§1)             | 80 detalles, 6 participantes activos, 90 % de cobertura, 15 % validados; 0,5 s por petición  |
| Acceso (§1.4)                | una cuenta ajena al proyecto recibe 404                                                      |
| Análisis completo (§2)       | `done`, sin etapas fallidas: 69 s el primero (carga de modelos) y 6 s el segundo             |
| Temas (§2.3)                 | pagos, seguridad (sesión) y notificaciones (entrega) salen como temas distintos              |
| Calidad y duplicados (§3)    | los 3 pares sembrados (similitud 0,97–1,00); confirmar uno deja 79 detalles activos y, tras rechazar otro, el siguiente análisis solo propone 1 |
| Patrones (§4)                | sentimiento, 30 reglas, 2 actividades calientes y 2 frías                                    |
| Obsolescencia (§6.1)         | tras las decisiones, el último análisis queda marcado como desactualizado                    |
| Programación (§6.2)          | desactivada por defecto; se activa y se desactiva desde los ajustes                          |
| Insights (§5)                | sin `ANTHROPIC_API_KEY` ni flag `insights`: regenerar responde 409 `INSIGHTS_DISABLED`       |

Pendiente, porque no se puede comprobar por la API:

- Recorrer las pantallas en el navegador (gráficos, pestañas, panel de evidencias); la página
  responde y los E2E del CI las cubren contra Compose.
- Memoria de `analysis-worker` en el panel de Railway (en local, 2 GB de pico con 5 000
  detalles) y confirmar que el servicio dispone de al menos 4 GB.
- Insights con Claude en staging: requiere `ANTHROPIC_API_KEY` en `analysis-worker` y
  `insights=true` en `api`.
- **Evaluación con analistas (SC-005)**: sobre un proyecto real, los analistas valoran los
  hallazgos generados (objetivo: al menos el 70 % considerados útiles). La valoración «no útil»
  de cada hallazgo queda registrada en `insight_feedback`. SC-006 (todo hallazgo enlaza a sus
  datos) lo garantiza la verificación de evidencias y lo cubren las pruebas.
