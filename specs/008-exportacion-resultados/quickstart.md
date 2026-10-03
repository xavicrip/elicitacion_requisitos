# Quickstart: Exportación de requisitos y reportes

Requiere 001–007 (con un análisis completado de "Tienda demo", `seed:analytics`) y el flag
`exports=true` (Compose lo activa). El PDF lo genera `analytics-worker`, que `pnpm dev:up` ya
levanta.

## 1. CSV y Excel (US1)

1. *Exportar → Excel* → se descarga al instante (80 detalles) con 18 columnas y la hoja
   "Resumen".
2. Filtrar por *Validado* y exportar a CSV → solo los validados.
3. Abrir el CSV en Excel y en LibreOffice → tildes, "ñ", comas y saltos de línea correctos;
   1 fila por detalle.
4. Crear un detalle con Dado `=HYPERLINK("http://x","clic")` y exportar → la celda muestra el
   texto literal, no una fórmula.
5. Con más de 1 000 detalles: exportar a Excel → 202 → aviso "Tu exportación está lista"; con
   2 000, en < 10 s (SC-001, `pnpm e2e:perf -g exportación`).

## 2. Gherkin (US2)

1. *Exportar → Gherkin* → ZIP con una carpeta por diagrama y un `.feature` por actividad con
   escenarios validados.
2. Activar *Incluir pendientes* → aparecen más escenarios.
3. Validación:
   ```bash
   pnpm --filter @reqcanvas/api test -- gherkin      # analiza cada .feature con @cucumber/gherkin (SC-002)
   ```

## 3. PDF (US3)

1. *Exportar → Reporte PDF* → 202 → al estar listo, descargar: portada, KPIs, diagrama con
   cobertura, distribuciones, hallazgos y anexo.
2. Comparar los KPIs del PDF con los del dashboard → idénticos (SC-004).
3. En un proyecto sin análisis → las secciones de hallazgos muestran "Análisis no disponible".
4. Con 2 000 detalles → listo en < 2 min (SC-003).

## 4. Caducidad, permisos y auditoría

1. Pasadas 24 h la descarga responde "El enlace caducó" (410) y la limpieza horaria borra el
   archivo; se cubre con las pruebas de integración (`exports-expiry`).
2. Como Participante: el menú *Exportar* no aparece y `POST /api/projects/:id/exports` → 403.
3. `audit_logs` contiene `export.requested` y `export.downloaded`.

## 5. Pruebas

```bash
pnpm --filter @reqcanvas/api test -- exports
cd apps/analytics && uv run pytest tests -k report
pnpm e2e --project=flows exports
```
