# Feature Specification: Detección asistida de actividades en la imagen

**Feature Branch**: `006-deteccion-asistida`
**Created**: 2026-09-25
**Status**: Draft
**Input**: User description: "Al subir la imagen de un diagrama de actividades, el sistema propone automáticamente las zonas de actividades, decisiones y nodos de inicio y fin, extrae el texto de cada una y, opcionalmente, las transiciones; el administrador revisa, acepta o corrige las propuestas antes de publicar (prompt.md RF-03 paso 2, Fase 5)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Propuesta automática de actividades (Priority: P1)

Tras subir un diagrama, el Administrador pulsa "Detectar actividades". En segundo plano, el
sistema analiza la imagen y, al terminar, muestra en el editor las zonas propuestas, con el
nombre leído de cada una y su tipo (acción, decisión, inicio, fin), marcadas como
"propuesta".

**Why this priority**: es la parte de "convertir la imagen en espacio de trabajo" que ahorra
más tiempo al Administrador.

**Independent Test**: con un diagrama de ejemplo limpio de 15 actividades, ejecutar la
detección y contar cuántas propuestas coinciden con las actividades reales.

**Acceptance Scenarios**:

1. **Given** un diagrama en *borrador* sin actividades, **When** el Administrador pulsa "Detectar
   actividades", **Then** ve un indicador de progreso y puede seguir usando la aplicación
   mientras tanto.
2. **Given** que termina la detección, **When** el Administrador abre el editor, **Then** ve las
   zonas propuestas con su nombre, su tipo y un nivel de confianza (alta, media, baja).
3. **Given** un diagrama sin formas reconocibles (p. ej., una fotografía), **When** termina la
   detección, **Then** el sistema informa que no encontró actividades y sugiere el marcado
   manual.
4. **Given** que la detección falla por un error interno, **When** ocurre, **Then** el
   Administrador ve un mensaje claro y puede reintentar o continuar manualmente.

---

### User Story 2 - Revisar y confirmar las propuestas (Priority: P1)

El Administrador revisa cada propuesta: la acepta, corrige su nombre, su tipo o su zona, o la
descarta. También puede aceptar todas las de confianza alta de una vez. Solo las propuestas
aceptadas se convierten en actividades.

**Why this priority**: la detección es imperfecta; el control humano es obligatorio
(Principio VII de la constitución).

**Independent Test**: aceptar 3 propuestas, corregir el nombre de otra y descartar una; verificar
que solo existen 4 actividades y que ninguna quedó sin revisar al publicar.

**Acceptance Scenarios**:

1. **Given** una propuesta, **When** el Administrador la acepta, **Then** se convierte en una
   actividad normal, editable como cualquier otra.
2. **Given** una propuesta con un nombre mal leído, **When** el Administrador corrige el texto y la
   acepta, **Then** la actividad se crea con el nombre corregido.
3. **Given** varias propuestas de confianza alta, **When** pulsa "Aceptar todas las de confianza
   alta", **Then** se aceptan todas ellas y el resto sigue pendiente.
4. **Given** propuestas pendientes de revisión, **When** intenta publicar, **Then** el sistema le
   pide aceptarlas o descartarlas antes.

---

### User Story 3 - Propuesta de transiciones (Priority: P3)

Además de las actividades, el sistema propone las transiciones (flechas) entre ellas para
reconstruir el flujo del proceso. El Administrador las revisa igual que las actividades.

**Why this priority**: enriquece el modelo del proceso y el análisis posterior, pero el sistema
funciona sin ellas.

**Independent Test**: con un diagrama lineal de 5 actividades, verificar que se proponen las
4 transiciones en el orden correcto.

**Acceptance Scenarios**:

1. **Given** una detección completada, **When** hay flechas reconocibles, **Then** se proponen
   transiciones entre las actividades detectadas, dibujadas en el editor.
2. **Given** una transición propuesta incorrecta, **When** el Administrador la descarta, **Then** no
   se añade al modelo.

---

### Edge Cases

- Se ejecuta la detección sobre un diagrama que ya tiene actividades manuales: las propuestas
  que se superponen a una actividad existente se marcan como "posible duplicado" y no se
  aceptan en bloque.
- Texto manuscrito o de baja resolución: se propone la zona con el nombre vacío y confianza
  baja.
- Diagramas en inglés u otros idiomas: se lee el texto tal cual, sin traducirlo.
- El Administrador vuelve a ejecutar la detección: las propuestas pendientes anteriores se
  reemplazan; las actividades ya aceptadas no se modifican.
- Imágenes muy grandes: la detección puede tardar más, pero debe terminar o fallar con un
  mensaje en menos de 3 minutos.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El Administrador DEBE poder iniciar la detección sobre una versión de diagrama en
  *borrador*.
- **FR-002**: La detección DEBE ejecutarse en segundo plano y exponer su estado (*en cola*, *en
  proceso*, *completada*, *fallida*) y su progreso.
- **FR-003**: La detección DEBE proponer zonas de actividad con su tipo (acción, decisión,
  inicio, fin), el texto leído y un nivel de confianza.
- **FR-004**: La detección PUEDE proponer transiciones dirigidas entre las zonas propuestas.
- **FR-005**: Las propuestas NO DEBEN convertirse en actividades sin la aceptación explícita
  del Administrador.
- **FR-006**: El Administrador DEBE poder aceptar, editar y aceptar, o descartar cada propuesta,
  y aceptar en bloque las de confianza alta.
- **FR-007**: No se DEBE poder publicar una versión con propuestas pendientes de revisión.
- **FR-008**: El sistema DEBE marcar como "posible duplicado" las propuestas que se superponen
  a actividades existentes.
- **FR-009**: El sistema DEBE registrar las métricas de cada detección (propuestas, aceptadas,
  corregidas, descartadas) para evaluar su precisión.

### Key Entities

- **Trabajo de detección**: ejecución de la detección sobre una versión de diagrama (estado,
  progreso, fechas, error si lo hubo, métricas).
- **Propuesta de actividad**: zona sugerida con tipo, texto leído, confianza y estado
  (*pendiente*, *aceptada*, *descartada*).
- **Propuesta de transición**: relación sugerida entre dos propuestas, con confianza y estado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En diagramas digitales limpios (hechos con herramientas UML), al menos el 85 % de
  las actividades reales se propone correctamente (zona y tipo).
- **SC-002**: En esos diagramas, al menos el 80 % de los nombres se lee sin necesidad de
  corrección.
- **SC-003**: La detección termina en menos de 60 segundos para diagramas de hasta 50
  actividades.
- **SC-004**: El tiempo total para preparar un diagrama de 20 actividades (detección + revisión)
  es al menos un 50 % menor que con el marcado manual de la feature 003.

## Assumptions

- Depende de la feature 003 (diagramas, editor y actividades).
- El caso principal son diagramas digitales exportados de herramientas UML; las fotos de
  pizarras o los diagramas a mano son un caso secundario con menor precisión esperada.
- La detección puede apoyarse en un servicio de IA externo; si no está configurado, el
  sistema usa solo detección local de formas y texto.
- Las propuestas de transición son deseables pero no bloquean la entrega de las historias P1.
