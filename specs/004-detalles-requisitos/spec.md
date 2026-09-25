# Feature Specification: Detalles de requisitos por actividad

**Feature Branch**: `004-detalles-requisitos`
**Created**: 2026-09-25
**Status**: Draft
**Input**: User description: "Al seleccionar una actividad del canvas, los miembros registran detalles de requisitos con la estructura Dado (qué/contexto) / Cuando (acción) / Entonces (resultado), además de tipo, prioridad, rol y etiquetas; pueden votar y comentar; el administrador modera; se muestra la cobertura en el diagrama (prompt.md RF-04 indicadores, RF-05)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar un detalle en una actividad (Priority: P1)

Un Participante selecciona una actividad del diagrama; se abre un panel lateral con los
detalles ya registrados y un formulario. La persona escribe el **Dado** (contexto), el
**Cuando** (acción) y el **Entonces** (resultado), elige el tipo y, opcionalmente, la
prioridad, su rol y etiquetas, y lo guarda.

**Why this priority**: es el propósito central del sistema: recopilar requisitos anclados a
una actividad.

**Independent Test**: seleccionar una actividad, registrar un detalle y verificar que aparece
en el panel con autor y fecha, y que persiste al recargar.

**Acceptance Scenarios**:

1. **Given** un proyecto *abierto* y una actividad seleccionada, **When** completo Dado, Cuando,
   Entonces y el tipo, y guardo, **Then** el detalle aparece en el panel con mi nombre y la fecha.
2. **Given** el formulario, **When** dejo vacío alguno de Dado, Cuando o Entonces, **Then** no se
   puede guardar y se indica qué campo falta.
3. **Given** una actividad con detalles de otras personas, **When** la selecciono, **Then** veo
   todos sus detalles, ordenados por votos y luego por fecha.
4. **Given** un proyecto *cerrado*, **When** selecciono una actividad, **Then** veo los detalles
   pero no el formulario.

---

### User Story 2 - Editar y eliminar mis detalles (Priority: P1)

El autor de un detalle puede corregirlo o eliminarlo mientras el proyecto está abierto. Cada
cambio queda en el historial del detalle.

**Why this priority**: los requisitos se refinan; sin edición, se acumulan duplicados.

**Independent Test**: editar un detalle propio, consultar su historial y ver la versión
anterior; intentar editar el de otra persona y comprobar que no está permitido.

**Acceptance Scenarios**:

1. **Given** un detalle mío, **When** cambio su Entonces y guardo, **Then** el detalle se
   actualiza y el historial muestra el valor anterior, quién lo cambió y cuándo.
2. **Given** un detalle de otra persona, **When** lo veo, **Then** no tengo opciones de edición ni
   eliminación (salvo que sea Administrador).
3. **Given** un detalle mío, **When** lo elimino y confirmo, **Then** desaparece del panel y queda
   registrado en auditoría.
4. **Given** que otra persona modificó el detalle mientras yo lo editaba, **When** guardo,
   **Then** el sistema me avisa del conflicto y me muestra ambas versiones para decidir.

---

### User Story 3 - Indicadores de cobertura en el diagrama (Priority: P2)

En el diagrama, cada actividad muestra cuántos detalles tiene; las actividades sin detalles se
destacan con una marca "sin detalles". Un modo "mapa de calor" colorea las actividades según
el número de aportes, y junto a cada actividad se pueden desplegar notas con el resumen de
sus detalles.

**Why this priority**: orienta a los participantes hacia las actividades menos cubiertas.

**Independent Test**: con detalles en 3 de 10 actividades, comprobar los contadores, las
7 marcas "sin detalles" y los colores del mapa de calor.

**Acceptance Scenarios**:

1. **Given** una actividad con 4 detalles, **When** veo el diagrama, **Then** la actividad muestra
   el contador "4".
2. **Given** una actividad sin detalles, **When** veo el diagrama, **Then** muestra la marca
   "sin detalles".
3. **Given** el modo mapa de calor activado, **When** veo el diagrama, **Then** las actividades se
   colorean en una escala de menos a más aportes, con leyenda.
4. **Given** una actividad con detalles, **When** despliego sus notas, **Then** veo junto a ella
   un resumen breve de cada detalle, y puedo contraerlas.

---

### User Story 4 - Votar y comentar detalles (Priority: P2)

Los miembros votan (+1) los detalles con los que están de acuerdo y comentan para pedir
aclaraciones o aportar matices.

**Why this priority**: prioriza por consenso y enriquece los requisitos sin duplicarlos.

**Independent Test**: votar un detalle ajeno, ver el contador subir, retirar el voto; añadir un
comentario y verlo bajo el detalle.

**Acceptance Scenarios**:

1. **Given** un detalle de otra persona, **When** lo voto, **Then** el contador aumenta en 1 y el
   botón indica que ya voté; **When** vuelvo a pulsar, **Then** se retira mi voto.
2. **Given** un detalle propio, **When** intento votarlo, **Then** no está permitido.
3. **Given** un detalle, **When** escribo un comentario y lo publico, **Then** aparece debajo con
   mi nombre y la fecha; puedo editar o eliminar mis comentarios.

---

### User Story 5 - Moderar detalles (Priority: P3)

El Administrador revisa los detalles y marca cada uno como *validado*, *duplicado* (indicando
de cuál) o *descartado* (con un motivo). Puede filtrar el panel por estado.

**Why this priority**: prepara los requisitos para el análisis y la exportación.

**Independent Test**: marcar un detalle como duplicado de otro y verificar que se muestra con
ese estado y el enlace al original.

**Acceptance Scenarios**:

1. **Given** un detalle *pendiente*, **When** el Administrador lo marca como *validado*, **Then**
   se muestra con ese estado y su autor ya no puede editarlo.
2. **Given** dos detalles equivalentes, **When** el Administrador marca uno como *duplicado* del
   otro, **Then** el duplicado se muestra atenuado con un enlace al original y sus votos se
   suman al original en los indicadores.
3. **Given** un detalle, **When** el Administrador lo *descarta* con un motivo, **Then** el autor
   ve el motivo.
4. **Given** el panel de una actividad, **When** filtro por estado, **Then** solo veo los detalles
   con ese estado.

---

### Edge Cases

- Texto muy largo: Dado, Cuando y Entonces admiten hasta 1 000 caracteres cada uno; el
  contador de caracteres avisa antes del límite.
- Texto con HTML o scripts: se muestra como texto literal, nunca se interpreta.
- Se retira a un miembro del proyecto: sus detalles, votos y comentarios se conservan con su
  nombre.
- Se elimina un detalle con votos y comentarios: se eliminan con él, tras confirmación.
- Una actividad se elimina de una nueva versión del diagrama: sus detalles quedan como
  "huérfanos" visibles para el Administrador, que puede reasignarlos a otra actividad.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Seleccionar una actividad DEBE abrir un panel con sus detalles y, si el proyecto
  está abierto, el formulario de alta.
- **FR-002**: Un detalle DEBE tener Dado, Cuando y Entonces (obligatorios, 5–1 000 caracteres
  cada uno) y un tipo: Funcional, No funcional, Regla de negocio o Restricción.
- **FR-003**: Un detalle PUEDE tener prioridad MoSCoW (Must, Should, Could, Won't), rol del
  autor (texto de hasta 60 caracteres, con sugerencias de roles usados antes en el proyecto)
  y hasta 10 etiquetas.
- **FR-004**: Varias personas DEBEN poder registrar detalles en la misma actividad.
- **FR-005**: Solo el autor o un Administrador DEBEN poder editar o eliminar un detalle; los
  detalles *validados* solo los puede editar un Administrador.
- **FR-006**: Cada modificación DEBE registrarse en el historial del detalle (valores anterior
  y nuevo, autor, fecha).
- **FR-007**: El sistema DEBE detectar ediciones concurrentes del mismo detalle y evitar que se
  pierdan cambios en silencio.
- **FR-008**: Los miembros DEBEN poder votar una vez cada detalle ajeno y retirar su voto.
- **FR-009**: Los miembros DEBEN poder comentar los detalles y editar o eliminar sus propios
  comentarios.
- **FR-010**: El Administrador DEBE poder cambiar el estado de un detalle a *pendiente*,
  *validado*, *duplicado* (con referencia al original) o *descartado* (con motivo).
- **FR-011**: El diagrama DEBE mostrar por actividad el número de detalles, la marca "sin
  detalles", un modo mapa de calor con leyenda y notas desplegables con el resumen de
  detalles.
- **FR-012**: El panel DEBE permitir filtrar por tipo, prioridad, estado y etiqueta, y ordenar
  por votos o por fecha.
- **FR-013**: En un proyecto *cerrado* no se pueden crear, editar ni votar detalles ni
  comentarios.

### Key Entities

- **Detalle de requisito**: escenario Dado/Cuando/Entonces ligado a una actividad; con tipo,
  prioridad, rol, etiquetas, estado, autor y fechas.
- **Voto**: apoyo de un miembro a un detalle (uno por miembro y detalle).
- **Comentario**: texto de un miembro sobre un detalle.
- **Historial de cambios**: versión anterior de un detalle, con autor y fecha del cambio.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un participante registra un detalle completo en menos de 2 minutos desde que
  selecciona la actividad.
- **SC-002**: El 100 % de los detalles guardados tiene sus tres componentes (Dado, Cuando,
  Entonces) y está asociado a una actividad.
- **SC-003**: El panel de una actividad con 200 detalles se abre en menos de 1 segundo.
- **SC-004**: En las pruebas de usabilidad, el 90 % de los participantes identifica en el
  diagrama qué actividades no tienen detalles en menos de 10 segundos.

## Assumptions

- La actualización en tiempo real de detalles, votos y comentarios entre usuarios se
  especifica en la feature 005; esta feature funciona con actualización al recargar o al
  volver a abrir el panel.
- Los Administradores también pueden registrar detalles.
- "Qué (contexto)" del prompt original equivale a "Dado" en la notación de escenarios.
