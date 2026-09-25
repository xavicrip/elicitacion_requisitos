# Contrato: formatos de exportación

## CSV / Excel — columnas (en este orden)

| # | Encabezado | Origen | Notas |
|---|------------|--------|-------|
| 1 | `ID` | `details._id` (8 caracteres finales) | |
| 2 | `Diagrama` | `diagrams.name` | |
| 3 | `Actividad` | `activities.label` (versión publicada) | "(huérfano)" si ya no existe |
| 4 | `Dado` | `given` | |
| 5 | `Cuando` | `when` | |
| 6 | `Entonces` | `then` | |
| 7 | `Tipo` | `type` → Funcional / No funcional / Regla de negocio / Restricción | |
| 8 | `Prioridad` | `priority` → Must / Should / Could / Won't / vacío | |
| 9 | `Rol` | `authorRole` | |
| 10 | `Etiquetas` | `tags` unidas con `; ` | |
| 11 | `Estado` | Pendiente / Validado / Duplicado / Descartado | |
| 12 | `Duplicado de` | ID corto del original | |
| 13 | `Motivo de descarte` | `discardReason` | |
| 14 | `Votos` | `voteCount` | Número |
| 15 | `Comentarios` | `commentCount` | Número |
| 16 | `Autor` | `users.name` | |
| 17 | `Creado` | `createdAt` | ISO-8601 en CSV; fecha y hora en Excel (zona del proyecto) |
| 18 | `Actualizado` | `updatedAt` | Igual |

- CSV: UTF-8 con BOM, `\r\n`, todos los campos entre comillas, delimitador `,` o `;`.
- Todas las celdas de texto pasan por `neutralizeFormula`.
- Nombre del archivo: `reqcanvas-<proyecto>-<AAAAMMDD-HHmm>.{csv|xlsx}`.

## Gherkin — estructura del ZIP

```text
reqcanvas-<proyecto>-gherkin.zip
└── <diagrama>/
    ├── <actividad-1>.feature
    └── <actividad-2>.feature
```

Plantilla y reglas en `research.md` (R4). Solo se incluyen actividades con al menos un
escenario exportable.

## PDF — secciones

1. Portada: proyecto, fecha de generación, filtros aplicados, nº de detalles.
2. Resumen: KPIs (`kpiSnapshot`).
3. Diagramas: por cada diagrama publicado, la imagen con la cobertura y la leyenda.
4. Distribuciones: por tipo, prioridad, estado y actividad.
5. Hallazgos (si hay `analysisRunId`): temas, calidad (los 10 de menor puntaje), actividades
   calientes y frías, reglas de asociación (top 10) e insights con sus evidencias (IDs cortos).
6. Anexo: requisitos por diagrama → actividad, en formato Dado/Cuando/Entonces con sus
   metadatos.

Pie de página: número de página y "Generado por ReqCanvas".
