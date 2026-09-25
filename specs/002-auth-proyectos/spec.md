# Feature Specification: Autenticación, roles y gestión de proyectos

**Feature Branch**: `002-auth-proyectos`
**Created**: 2026-09-25
**Status**: Draft
**Input**: User description: "Registro e inicio de sesión, roles Administrador y Participante por proyecto, CRUD de proyectos de levantamiento con estados borrador/abierto/cerrado e invitación de participantes (prompt.md RF-01, RF-02 parcial, §2)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registro e inicio de sesión (Priority: P1)

Una persona crea su cuenta con nombre, email y contraseña, inicia sesión y permanece
autenticada mientras usa la aplicación, hasta que cierra sesión.

**Why this priority**: todas las demás funcionalidades requieren saber quién es el usuario.

**Independent Test**: registrar una cuenta, cerrar sesión, volver a iniciar sesión y ver la
página "Mis proyectos" (vacía).

**Acceptance Scenarios**:

1. **Given** una persona sin cuenta, **When** se registra con nombre, email válido y una
   contraseña que cumple la política, **Then** la cuenta se crea y queda con la sesión iniciada.
2. **Given** un email ya registrado, **When** alguien intenta registrarse con él, **Then** el
   sistema lo rechaza con un mensaje que no revela datos de la cuenta existente.
3. **Given** una cuenta existente, **When** la persona introduce una contraseña incorrecta
   5 veces en 15 minutos, **Then** el sistema bloquea temporalmente nuevos intentos durante
   15 minutos.
4. **Given** una sesión iniciada, **When** la persona cierra sesión, **Then** ya no puede acceder
   a páginas protegidas sin volver a autenticarse.

---

### User Story 2 - Crear y gestionar proyectos de levantamiento (Priority: P1)

Un usuario crea un proyecto de levantamiento de requisitos (nombre y descripción) y se
convierte automáticamente en su **Administrador**. Puede editarlo, cambiar su estado
(borrador → abierto → cerrado) y eliminarlo.

**Why this priority**: el proyecto es el contenedor de diagramas, participantes y requisitos.

**Independent Test**: crear un proyecto, editar su descripción, abrirlo, cerrarlo y
comprobar que aparece en "Mis proyectos" con el estado correcto.

**Acceptance Scenarios**:

1. **Given** un usuario autenticado, **When** crea un proyecto con nombre, **Then** el proyecto se
   crea en estado *borrador* y el usuario queda como Administrador.
2. **Given** un proyecto en *borrador*, **When** el Administrador lo cambia a *abierto*, **Then**
   los participantes invitados pueden aportar requisitos.
3. **Given** un proyecto *abierto*, **When** el Administrador lo *cierra*, **Then** nadie puede
   crear, editar ni votar requisitos, pero todos los miembros pueden consultarlos.
4. **Given** un proyecto, **When** el Administrador solicita eliminarlo, **Then** el sistema pide
   confirmación escribiendo el nombre del proyecto antes de eliminarlo.

---

### User Story 3 - Invitar participantes (Priority: P2)

El Administrador genera un enlace de invitación (o invita por email) para que otras personas
se unan al proyecto como **Participantes**. El Administrador ve la lista de miembros, puede
cambiar su rol o retirarlos del proyecto.

**Why this priority**: el levantamiento es colaborativo; sin participantes no hay aportes.

**Independent Test**: generar un enlace, abrirlo con otra cuenta, aceptar y verificar que el
proyecto aparece en "Mis proyectos" de esa cuenta con rol Participante.

**Acceptance Scenarios**:

1. **Given** un proyecto, **When** el Administrador genera un enlace de invitación, **Then** el
   enlace es válido durante 7 días o hasta que se revoque.
2. **Given** un enlace válido, **When** una persona autenticada lo abre, **Then** se une al proyecto
   como Participante; si no tiene cuenta, se le pide registrarse y luego se completa la unión.
3. **Given** un enlace revocado o caducado, **When** alguien lo abre, **Then** ve un mensaje
   claro y no se une al proyecto.
4. **Given** un Participante, **When** el Administrador lo retira del proyecto, **Then** pierde el
   acceso de inmediato, pero sus aportes previos se conservan con su autoría.
5. **Given** un Participante, **When** el Administrador lo promueve a Administrador, **Then**
   obtiene todos los permisos de administración de ese proyecto.

---

### User Story 4 - Control de acceso por rol (Priority: P1)

El sistema garantiza que cada persona solo ve y hace lo que su rol le permite en cada
proyecto, sin importar cómo intente acceder.

**Why this priority**: la información de negocio aportada por terceros es sensible.

**Independent Test**: con una cuenta Participante, intentar acceder directamente a funciones
de administración (por URL o por petición directa) y verificar que se deniegan.

**Acceptance Scenarios**:

1. **Given** un usuario que no es miembro de un proyecto, **When** intenta acceder a él,
   **Then** el sistema responde como si el proyecto no existiera.
2. **Given** un Participante, **When** intenta acceder al dashboard, a la gestión de miembros o a
   la subida de diagramas, **Then** el acceso se deniega.

---

### Edge Cases

- El último Administrador de un proyecto intenta degradarse o abandonar el proyecto: el
  sistema lo impide hasta que haya otro Administrador.
- La sesión caduca mientras la persona escribe: al renovarse no se pierde el texto en edición.
- Una invitación se usa varias veces: se permite hasta que se revoque o caduque (enlace
  multiuso); un usuario que ya es miembro no se duplica.
- Se elimina un proyecto con aportes: se eliminan también sus diagramas, requisitos y
  análisis, tras la confirmación explícita.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir el registro con nombre, email y contraseña.
- **FR-002**: La contraseña DEBE tener al menos 10 caracteres y no puede figurar en una lista
  de contraseñas comunes.
- **FR-003**: El sistema DEBE permitir iniciar y cerrar sesión, y mantener la sesión activa de
  forma segura con renovación automática.
- **FR-004**: El sistema DEBE limitar los intentos fallidos de inicio de sesión (5 intentos en
  15 minutos por cuenta y por origen).
- **FR-005**: Los usuarios DEBEN poder crear, ver, editar y eliminar proyectos con nombre
  (obligatorio, máx. 100 caracteres), descripción (opcional, máx. 2 000) y estado.
- **FR-006**: El estado de un proyecto DEBE seguir el ciclo *borrador → abierto → cerrado*; el
  Administrador puede reabrir un proyecto cerrado.
- **FR-007**: El rol DEBE asignarse por proyecto: una persona puede ser Administrador en uno y
  Participante en otro.
- **FR-008**: El Administrador DEBE poder generar, listar y revocar enlaces de invitación con
  caducidad de 7 días.
- **FR-009**: El Administrador DEBE poder cambiar el rol de un miembro y retirarlo del proyecto.
- **FR-010**: Todo proyecto DEBE tener al menos un Administrador.
- **FR-011**: El sistema DEBE verificar el rol en cada operación, del lado del servidor.
- **FR-012**: "Mis proyectos" DEBE listar los proyectos del usuario con su rol, estado y
  fecha de última actividad.
- **FR-013**: El sistema DEBE registrar en auditoría los cambios de rol, las invitaciones y los
  cambios de estado de los proyectos.

### Key Entities

- **Usuario**: persona con cuenta (nombre, email, credencial protegida, fecha de alta).
- **Proyecto**: contenedor del levantamiento (nombre, descripción, estado, fechas).
- **Membresía**: relación Usuario–Proyecto con un rol (Administrador o Participante).
- **Invitación**: enlace para unirse a un proyecto, con caducidad, estado (activa, revocada)
  y quién la creó.
- **Registro de auditoría**: quién hizo qué acción, sobre qué entidad y cuándo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona nueva se registra e inicia sesión en menos de 1 minuto.
- **SC-002**: Un Administrador crea un proyecto e invita a un participante en menos de 2 minutos.
- **SC-003**: El 100 % de los intentos de acceso no autorizados de las pruebas de seguridad
  son denegados.
- **SC-004**: El 95 % de las personas invitadas se une al proyecto al primer intento, sin
  ayuda.

## Assumptions

- La invitación principal es por enlace; el envío por email es opcional y depende de disponer de
  un servicio de correo (si no hay, el Administrador copia y comparte el enlace).
- No se incluyen en la v1 la recuperación de contraseña por email ni el inicio de sesión con
  proveedores externos (Google, Microsoft); se pueden añadir después.
- No existe un "superadministrador" global en la v1: cualquier usuario registrado puede crear
  proyectos.
- La gestión de diagramas dentro del proyecto se especifica en la feature 003.
