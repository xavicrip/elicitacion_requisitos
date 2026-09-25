# Feature Specification: Colaboración en tiempo real

**Feature Branch**: `005-colaboracion-tiempo-real`
**Created**: 2026-09-25
**Status**: Draft
**Input**: User description: "Los detalles, votos y comentarios aparecen al instante para todos los que están en el espacio de trabajo; se ve quién está conectado y sus cursores en vivo, al estilo Miro o Mural; los conflictos de edición se resuelven sin pérdida de datos (prompt.md RF-06, RNF-02)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver los aportes de los demás al instante (Priority: P1)

Mientras varias personas trabajan en el mismo diagrama, cualquier detalle, voto, comentario o
cambio de estado que hace una aparece en las pantallas de las demás en menos de un segundo,
sin recargar la página. Los contadores y el mapa de calor también se actualizan.

**Why this priority**: es lo que convierte la herramienta en un espacio colaborativo.

**Independent Test**: abrir el mismo diagrama en dos navegadores con cuentas distintas,
registrar un detalle en uno y verlo aparecer en el otro.

**Acceptance Scenarios**:

1. **Given** dos miembros con el mismo diagrama abierto, **When** uno registra un detalle en una
   actividad, **Then** el otro ve el contador de esa actividad actualizado y, si tiene el panel
   abierto, el nuevo detalle, en menos de 1 segundo.
2. **Given** dos miembros en el mismo panel, **When** uno vota o comenta, **Then** el otro ve el
   voto o el comentario sin recargar.
3. **Given** un Administrador que valida un detalle, **When** lo hace, **Then** todos los miembros
   conectados ven el nuevo estado.
4. **Given** un miembro viendo otro proyecto, **When** alguien aporta en este, **Then** no recibe
   esos eventos (aislamiento entre proyectos).

---

### User Story 2 - Presencia: quién está conectado (Priority: P2)

En el espacio de trabajo se ve la lista de personas conectadas, cada una con su nombre y un
color. Al seleccionar una actividad, los demás ven un indicador con el color de esa persona
sobre la actividad.

**Why this priority**: da contexto social y evita que dos personas escriban lo mismo.

**Independent Test**: conectar tres cuentas y verificar que cada una ve a las otras dos en la
lista; desconectar una y verificar que desaparece.

**Acceptance Scenarios**:

1. **Given** tres miembros en el mismo diagrama, **When** miro la lista de presencia, **Then** veo
   a los otros dos con su nombre y color.
2. **Given** un miembro que cierra la pestaña, **When** pasan 10 segundos, **Then** deja de aparecer
   en la lista de los demás.
3. **Given** un miembro que selecciona una actividad, **When** los demás miran el diagrama,
   **Then** ven un indicador con su color sobre esa actividad.

---

### User Story 3 - Cursores en vivo (Priority: P3)

Cada persona ve moverse los cursores de los demás sobre el diagrama, con su nombre, de forma
fluida y respetando el zoom y la posición de su propia vista.

**Why this priority**: mejora la sensación de pizarra compartida, sobre todo en sesiones
guiadas, pero no es imprescindible para aportar requisitos.

**Independent Test**: mover el cursor en un navegador y verlo moverse en el otro sobre el mismo
punto del diagrama, aunque ambos tengan zoom distinto.

**Acceptance Scenarios**:

1. **Given** dos miembros con zoom distinto, **When** uno mueve el cursor sobre una actividad,
   **Then** el otro ve su cursor sobre esa misma actividad.
2. **Given** los cursores en vivo, **When** una persona los oculta en sus preferencias, **Then**
   deja de ver los cursores ajenos.

---

### User Story 4 - Reconexión sin pérdida (Priority: P2)

Si la conexión se corta, la aplicación lo indica, reintenta conectarse automáticamente y, al
volver, muestra todo lo que ocurrió durante la desconexión, sin perder lo que la persona
estaba escribiendo.

**Why this priority**: las redes de aula y de oficina son inestables; no se debe perder trabajo.

**Independent Test**: cortar la red de un navegador, aportar desde otro, restablecer la red y
verificar que el primero recibe los cambios y conserva su borrador.

**Acceptance Scenarios**:

1. **Given** una pérdida de conexión, **When** ocurre, **Then** se muestra el aviso "Sin conexión:
   reintentando" y los botones de guardar quedan deshabilitados.
2. **Given** que la conexión vuelve, **When** se restablece, **Then** el diagrama y los paneles se
   sincronizan con los cambios ocurridos y el borrador en edición se conserva.

---

### Edge Cases

- Dos personas editan el mismo detalle a la vez: se aplica el control de conflictos de la
  feature 004 (nadie pierde cambios en silencio).
- Un miembro es retirado del proyecto mientras está conectado: su sesión en el espacio de
  trabajo se cierra de inmediato con un mensaje.
- El proyecto se cierra mientras hay miembros conectados: todos pasan a modo de solo lectura
  al instante.
- Muchos usuarios mueven el cursor a la vez: las actualizaciones de cursor se limitan en
  frecuencia para no degradar la experiencia.
- La sesión de una persona está abierta en varias pestañas: aparece una sola vez en la lista
  de presencia.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE propagar a los miembros conectados al mismo proyecto la creación,
  edición y eliminación de detalles, votos, comentarios, cambios de estado y cambios del
  diagrama publicado.
- **FR-002**: Los eventos DEBEN entregarse solo a los miembros autorizados del proyecto.
- **FR-003**: El sistema DEBE mostrar la lista de miembros conectados al diagrama, con nombre y
  color persistente por persona.
- **FR-004**: El sistema DEBE mostrar qué actividad tiene seleccionada cada miembro conectado.
- **FR-005**: El sistema DEBE mostrar los cursores de los demás miembros en coordenadas del
  diagrama, con opción para ocultarlos.
- **FR-006**: El sistema DEBE detectar la desconexión, reintentar automáticamente y
  resincronizar el estado al reconectar.
- **FR-007**: Los borradores en edición DEBEN conservarse durante la desconexión y la
  reconexión.
- **FR-008**: Retirar a un miembro o cerrar el proyecto DEBE aplicarse de inmediato a las
  sesiones conectadas.
- **FR-009**: El sistema DEBE funcionar igual con varias instancias del servidor en paralelo.

### Key Entities

- **Sesión de presencia**: miembro conectado a un diagrama (color, actividad seleccionada,
  última señal de vida).
- **Evento de colaboración**: notificación de un cambio (tipo, entidad, proyecto, autor,
  momento).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 95 % de los cambios aparece en las pantallas de los demás miembros en menos de
  500 ms.
- **SC-002**: 50 miembros conectados al mismo diagrama colaboran sin que se degrade la
  fluidez percibida.
- **SC-003**: Tras una desconexión de hasta 5 minutos, el 100 % de los cambios ocurridos se
  refleja al reconectar.
- **SC-004**: En una sesión de prueba con 10 participantes, ningún aporte se pierde ni se
  duplica.

## Assumptions

- Depende de las features 003 (espacio de trabajo) y 004 (detalles).
- La presencia es por diagrama; en la v1 no se muestran usuarios conectados a nivel de proyecto.
- No se contempla trabajar sin conexión (modo offline) más allá de conservar el borrador en
  edición.
