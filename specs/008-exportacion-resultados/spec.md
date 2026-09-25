# Feature Specification: Exportación de requisitos y reportes

**Feature Branch**: `008-exportacion-resultados`
**Created**: 2026-09-25
**Status**: Draft
**Input**: User description: "El administrador exporta los requisitos del proyecto a CSV/Excel, los escenarios en formato Gherkin (.feature) y un reporte PDF con los hallazgos del dashboard (prompt.md RF-07 Exportación, Fase 7)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Exportar requisitos a hoja de cálculo (Priority: P1)

El Administrador descarga todos los detalles del proyecto (o los filtrados) en CSV o Excel,
con una fila por detalle: diagrama, actividad, Dado, Cuando, Entonces, tipo, prioridad, rol,
etiquetas, estado, votos, número de comentarios, autor y fechas.

**Why this priority**: es el formato que los analistas usan para continuar el trabajo en otras
herramientas.

**Independent Test**: exportar un proyecto de 80 detalles, abrir el archivo en una hoja de
cálculo y verificar que hay 80 filas con todas las columnas y los acentos correctos.

**Acceptance Scenarios**:

1. **Given** un proyecto con detalles, **When** el Administrador exporta a Excel, **Then** descarga
   un archivo con una fila por detalle y las columnas indicadas.
2. **Given** filtros aplicados (p. ej., solo *validados*), **When** exporta, **Then** el archivo
   contiene solo los detalles filtrados.
3. **Given** textos con tildes, "ñ", comas y saltos de línea, **When** abro el CSV en una hoja de
   cálculo, **Then** se ven correctamente y cada detalle ocupa una sola fila.

---

### User Story 2 - Exportar escenarios en Gherkin (Priority: P2)

El Administrador descarga los detalles como archivos `.feature` en español: un archivo
(*Característica*) por actividad y un *Escenario* por detalle, con sus pasos *Dado*,
*Cuando* y *Entonces*, y las etiquetas, el tipo y la prioridad como etiquetas del escenario.

**Why this priority**: conecta el levantamiento con las pruebas de aceptación (BDD).

**Independent Test**: exportar, descomprimir y validar que los archivos se procesan sin errores
con una herramienta estándar de Gherkin en español.

**Acceptance Scenarios**:

1. **Given** un diagrama con 5 actividades con detalles, **When** exporto a Gherkin, **Then**
   descargo un archivo comprimido con 5 archivos `.feature` válidos.
2. **Given** un detalle con prioridad *Must* y etiqueta *pagos*, **When** se exporta, **Then** su
   escenario lleva las etiquetas `@must @pagos`.
3. **Given** que por defecto se exportan solo los detalles *validados*, **When** el Administrador
   elige incluir también los *pendientes*, **Then** también se exportan.

---

### User Story 3 - Reporte PDF del levantamiento (Priority: P2)

El Administrador genera un reporte PDF con: portada del proyecto, imagen del diagrama con el
mapa de cobertura, indicadores clave, principales hallazgos del análisis (temas, calidad,
actividades críticas, insights) y el listado de requisitos agrupado por actividad.

**Why this priority**: es el entregable formal para los interesados que no usan la aplicación.

**Independent Test**: generar el PDF del proyecto de ejemplo y verificar que contiene todas las
secciones y que los datos coinciden con el dashboard.

**Acceptance Scenarios**:

1. **Given** un proyecto con análisis completado, **When** genero el reporte, **Then** descargo un
   PDF con todas las secciones indicadas.
2. **Given** un proyecto sin análisis de texto, **When** genero el reporte, **Then** el PDF incluye
   las secciones descriptivas y omite (indicándolo) las de análisis.
3. **Given** un proyecto grande, **When** genero el reporte, **Then** se procesa en segundo plano y
   se me avisa cuando está listo para descargar.

---

### Edge Cases

- Proyecto sin detalles: la exportación genera el archivo con solo los encabezados y un aviso.
- Textos que empiezan por "=", "+", "-" o "@" en el CSV: se neutralizan para evitar la
  inyección de fórmulas en hojas de cálculo.
- Nombres de actividad con caracteres no válidos para nombres de archivo: se normalizan en
  los archivos `.feature`.
- Un Participante intenta exportar: se deniega.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Solo los Administradores DEBEN poder exportar.
- **FR-002**: El sistema DEBE exportar detalles a CSV (UTF-8 compatible con hojas de cálculo) y
  a Excel, respetando los filtros activos.
- **FR-003**: El sistema DEBE neutralizar el contenido que pueda interpretarse como fórmula en
  las hojas de cálculo.
- **FR-004**: El sistema DEBE exportar los escenarios en Gherkin en español (`# language: es`),
  un archivo por actividad, en un archivo comprimido.
- **FR-005**: El sistema DEBE generar un reporte PDF con portada, diagrama con cobertura,
  indicadores, hallazgos del análisis y listado de requisitos por actividad.
- **FR-006**: Las exportaciones grandes (más de 1 000 detalles o PDF) DEBEN generarse en segundo
  plano y notificar cuando estén listas.
- **FR-007**: Los archivos generados DEBEN estar disponibles para descarga durante 24 horas.
- **FR-008**: Cada exportación DEBE registrarse en auditoría (quién, qué formato, qué filtros).

### Key Entities

- **Exportación**: solicitud de un Administrador (formato, filtros, estado, fecha, archivo
  generado, caducidad).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: La exportación a CSV o Excel de 2 000 detalles está lista en menos de 10 segundos.
- **SC-002**: El 100 % de los archivos `.feature` exportados se procesa sin errores con una
  herramienta estándar de Gherkin.
- **SC-003**: El reporte PDF de un proyecto de 2 000 detalles está listo en menos de 2 minutos.
- **SC-004**: Los datos del reporte coinciden al 100 % con los del dashboard en el momento de
  generarlo.

## Assumptions

- Depende de las features 004 (detalles) y 007 (dashboard) para las secciones de análisis del
  PDF.
- No se incluye la importación de requisitos desde archivos en la v1.
- La integración directa con Jira o Azure DevOps está fuera del alcance (prompt.md §11).
