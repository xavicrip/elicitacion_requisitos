# Feature Specification: Diagramas de actividades y espacio de trabajo interactivo

**Feature Branch**: `003-diagramas-canvas`
**Created**: 2026-09-25
**Status**: Draft
**Input**: User description: "El administrador sube la imagen de un diagrama de actividades, marca manualmente las actividades como zonas seleccionables y publica el espacio de trabajo; los miembros navegan el diagrama en un canvas con zoom, desplazamiento y minimapa (prompt.md RF-02, RF-03 pasos 1, 3 y 4, RF-04)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Subir un diagrama al proyecto (Priority: P1)

El Administrador sube una imagen (PNG, JPG o SVG) de un diagrama de actividades a su
proyecto. El sistema la valida, la almacena y la muestra como fondo de un nuevo espacio de
trabajo en estado *borrador*.

**Why this priority**: sin el diagrama no hay espacio de trabajo.

**Independent Test**: subir una imagen válida y ver el diagrama en el editor; subir un archivo
no válido y ver el mensaje de error.

**Acceptance Scenarios**:

1. **Given** un proyecto del que soy Administrador, **When** subo un PNG de 3 MB, **Then** el
   diagrama aparece en el editor en estado *borrador*.
2. **Given** el formulario de subida, **When** subo un archivo de 15 MB o un PDF, **Then** el
   sistema lo rechaza indicando el límite de 10 MB y los formatos admitidos.
3. **Given** un proyecto con un diagrama publicado, **When** subo una nueva imagen como nueva
   versión, **Then** se crea una versión nueva en *borrador* y la versión publicada sigue
   disponible para los participantes hasta que publique la nueva.

---

### User Story 2 - Marcar actividades en el diagrama (Priority: P1)

En el editor, el Administrador dibuja una zona rectangular sobre cada actividad del diagrama,
le asigna un nombre y un tipo (acción, decisión, inicio, fin) y, opcionalmente, indica a qué
actividades lleva (transiciones). Puede mover, redimensionar, renombrar y eliminar zonas.

**Why this priority**: convierte una imagen estática en un modelo estructurado de actividades,
que es donde se anclan los requisitos (Principio I).

**Independent Test**: marcar 5 actividades en un diagrama de ejemplo, recargar la página y
comprobar que se conservan posición, tamaño, nombre y tipo.

**Acceptance Scenarios**:

1. **Given** un diagrama en *borrador*, **When** dibujo un rectángulo sobre una actividad y le
   pongo el nombre "Validar pago", **Then** se crea una actividad con ese nombre en esa posición.
2. **Given** una actividad marcada, **When** la arrastro o cambio su tamaño, **Then** su nueva
   posición se guarda automáticamente.
3. **Given** dos actividades, **When** defino que "Validar pago" lleva a "Emitir factura",
   **Then** la transición queda registrada en el modelo del diagrama.
4. **Given** una actividad sin requisitos, **When** la elimino, **Then** desaparece del diagrama.
5. **Given** una actividad con requisitos, **When** intento eliminarla, **Then** el sistema me
   advierte cuántos requisitos tiene y solo la elimina (junto con ellos) si confirmo.

---

### User Story 3 - Publicar el espacio de trabajo (Priority: P1)

Cuando el Administrador termina de marcar las actividades, publica el diagrama. Desde ese
momento, los participantes del proyecto pueden verlo y seleccionar sus actividades.

**Why this priority**: es el paso que habilita la colaboración.

**Independent Test**: publicar un diagrama y abrirlo con una cuenta Participante; comprobar
que las zonas se ven y se pueden seleccionar, pero no editar.

**Acceptance Scenarios**:

1. **Given** un diagrama en *borrador* con al menos una actividad, **When** lo publico, **Then**
   pasa a *publicado* y es visible para todos los miembros.
2. **Given** un diagrama sin actividades marcadas, **When** intento publicarlo, **Then** el
   sistema no lo permite y explica por qué.
3. **Given** un diagrama publicado, **When** un Participante lo abre, **Then** ve el diagrama con
   las actividades seleccionables y sin herramientas de edición.

---

### User Story 4 - Navegar el diagrama (Priority: P1)

Cualquier miembro navega el espacio de trabajo como en una pizarra digital: acerca y aleja,
se desplaza arrastrando, ajusta la vista a la pantalla, usa un minimapa para orientarse y
resalta una actividad al pasar el cursor sobre ella.

**Why this priority**: una navegación fluida es lo que hace útil un diagrama grande.

**Independent Test**: abrir un diagrama de 4000×3000 px y usar zoom, desplazamiento, "ajustar
a pantalla" y el minimapa, comprobando que la navegación es fluida.

**Acceptance Scenarios**:

1. **Given** un diagrama abierto, **When** uso la rueda del ratón o el gesto de pellizco, **Then**
   la vista se acerca o aleja centrada en el cursor, entre el 10 % y el 800 %.
2. **Given** un diagrama con zoom, **When** arrastro el fondo, **Then** la vista se desplaza.
3. **Given** cualquier vista, **When** pulso "Ajustar a pantalla", **Then** el diagrama completo
   queda visible.
4. **Given** un diagrama grande, **When** hago clic en un punto del minimapa, **Then** la vista
   se centra en ese punto.
5. **Given** una actividad, **When** paso el cursor sobre ella, **Then** se resalta y muestra su
   nombre; **When** hago clic, **Then** queda seleccionada (el panel de requisitos se especifica
   en la feature 004).
6. **Given** un teléfono móvil, **When** abro el diagrama, **Then** puedo navegar y seleccionar
   actividades, pero la edición no está disponible.

---

### Edge Cases

- La imagen es muy grande (p. ej., 12 000 px de ancho): el sistema la acepta si cumple el
  límite de 10 MB y genera una versión optimizada para la visualización.
- Un SVG contiene scripts o referencias externas: se sanea o se rechaza.
- Dos Administradores editan las zonas del mismo diagrama en borrador a la vez: se aplica la
  última modificación y el otro recibe un aviso de que el contenido cambió.
- Las zonas se superponen: se permite, y al hacer clic se selecciona la zona más pequeña bajo
  el cursor.
- Se publica una nueva versión del diagrama: los requisitos de las actividades que se
  conservan (mismo identificador) se mantienen; el Administrador decide qué hacer con los de
  actividades eliminadas.
- Navegador sin soporte de aceleración gráfica: se muestra un mensaje indicando los
  navegadores compatibles.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El Administrador DEBE poder subir imágenes PNG, JPG o SVG de hasta 10 MB; el
  sistema valida el tipo real del archivo, no solo la extensión.
- **FR-002**: Un proyecto DEBE poder tener varios diagramas, y cada diagrama varias versiones;
  solo una versión de cada diagrama está publicada a la vez.
- **FR-003**: El editor DEBE permitir crear, mover, redimensionar, renombrar, tipificar y
  eliminar zonas de actividad sobre la imagen.
- **FR-004**: Cada actividad DEBE tener nombre (obligatorio, máx. 120 caracteres), tipo
  (acción, decisión, inicio, fin), posición y tamaño relativos a la imagen.
- **FR-005**: El editor DEBE permitir definir transiciones dirigidas entre actividades.
- **FR-006**: Los cambios del editor DEBEN guardarse automáticamente, sin acción explícita.
- **FR-007**: Publicar DEBE requerir al menos una actividad; al publicar, la versión queda
  disponible para todos los miembros.
- **FR-008**: Al crear una nueva versión, el sistema DEBE copiar las actividades de la versión
  anterior para que el Administrador las ajuste.
- **FR-009**: El canvas DEBE ofrecer zoom (10 %–800 %), desplazamiento, "ajustar a pantalla",
  minimapa, resaltado al pasar el cursor y selección por clic o toque.
- **FR-010**: En pantallas pequeñas (menos de 768 px de ancho), el espacio de trabajo DEBE
  funcionar en modo de solo lectura.
- **FR-011**: El espacio de trabajo DEBE ser navegable con teclado (tabulación entre
  actividades, Enter para seleccionar, +/- para zoom).
- **FR-012**: Si el proyecto está *cerrado*, el diagrama DEBE mostrarse en modo de solo lectura.

### Key Entities

- **Diagrama**: diagrama de actividades de un proyecto (nombre, orden en el proyecto).
- **Versión de diagrama**: imagen concreta con sus dimensiones, estado (*borrador*,
  *publicado*, *archivado*) y fecha de publicación.
- **Actividad**: zona seleccionable de una versión (nombre, tipo, posición, tamaño),
  identificada de forma estable entre versiones.
- **Transición**: relación dirigida entre dos actividades de la misma versión.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un Administrador marca y publica un diagrama de 20 actividades en menos de
  10 minutos.
- **SC-002**: La navegación (zoom y desplazamiento) se percibe fluida, sin saltos visibles, con
  diagramas de hasta 100 actividades en un portátil de gama media.
- **SC-003**: Un diagrama publicado se abre y queda navegable en menos de 3 segundos con una
  conexión de 10 Mbps.
- **SC-004**: El 90 % de los participantes encuentra y selecciona una actividad concreta en
  menos de 15 segundos en las pruebas de usabilidad.

## Assumptions

- La detección automática de actividades a partir de la imagen se especifica en la feature
  006; esta feature cubre el marcado manual, que también sirve para corregir la detección.
- La edición del dibujo UML (cambiar las formas o flechas de la imagen) está fuera del alcance.
- Las zonas de actividad son rectangulares; los rombos y círculos se representan con su
  rectángulo envolvente.
- Solo el Administrador edita las zonas; los Participantes solo navegan y seleccionan.
