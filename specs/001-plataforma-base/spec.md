# Feature Specification: Plataforma base y entrega continua

**Feature Branch**: `001-plataforma-base`
**Created**: 2026-09-25
**Status**: Draft
**Input**: User description: "Fundaciones del sistema ReqCanvas: repositorio único con los servicios web, api y analytics, entorno local reproducible, pipeline de integración y despliegue continuo hacia staging y producción, con commits atómicos y reversibles (prompt.md §6, §7, §8, Fase 0)."

## User Scenarios & Testing *(mandatory)*

Los actores de esta feature son el **equipo de desarrollo** y el **responsable de operaciones**.
Aunque no aporta funcionalidades al usuario final, es la base sobre la que se entregan todas
las demás features.

### User Story 1 - Entorno local reproducible (Priority: P1)

Una persona del equipo clona el repositorio y, con un único comando documentado, levanta
localmente todos los servicios (interfaz web, API, servicio analítico, base de datos, cola)
y comprueba que cada uno responde como saludable.

**Why this priority**: sin un entorno local idéntico para todos, ninguna otra feature puede
desarrollarse ni probarse.

**Independent Test**: en una máquina limpia con los prerrequisitos del README, ejecutar el
comando de arranque y verificar que la página inicial carga y que cada servicio responde
"saludable".

**Acceptance Scenarios**:

1. **Given** un clon limpio del repositorio y los prerrequisitos instalados, **When** la persona
   ejecuta el comando de arranque documentado, **Then** todos los servicios quedan en ejecución
   en menos de 10 minutos y la página inicial de la aplicación muestra "ReqCanvas".
2. **Given** los servicios en ejecución, **When** se consulta el estado de salud de cada uno,
   **Then** todos informan "saludable", incluida su conexión con la base de datos y la cola.
3. **Given** que la base de datos está detenida, **When** se consulta la salud de la API,
   **Then** la API informa "no saludable" e indica qué dependencia falla.

---

### User Story 2 - Validación automática de cada cambio (Priority: P1)

Cada vez que alguien propone un cambio (Pull Request), el sistema de integración continua
valida automáticamente estilo, tipos, pruebas, construcción de los servicios y formato de los
mensajes de commit, e informa el resultado en el propio PR.

**Why this priority**: es la condición para que los commits sean atómicos y reversibles
(Principios III y IV de la constitución).

**Independent Test**: abrir un PR con un error de lint deliberado y comprobar que el pipeline
falla y bloquea la integración; corregirlo y comprobar que pasa.

**Acceptance Scenarios**:

1. **Given** un PR con código que no cumple las reglas de estilo, **When** se ejecuta el
   pipeline, **Then** el PR queda marcado como fallido y no se puede integrar.
2. **Given** un PR con un mensaje de commit que no sigue Conventional Commits, **When** se
   ejecuta el pipeline, **Then** la validación de commits falla e indica el commit incorrecto.
3. **Given** un PR correcto, **When** se ejecuta el pipeline, **Then** todas las etapas pasan en
   menos de 15 minutos y el PR queda habilitado para revisión.

---

### User Story 3 - Despliegue continuo a staging y producción (Priority: P2)

Al integrar un cambio en la rama principal, el sistema se despliega automáticamente en el
entorno de **staging**, ejecuta pruebas de humo y, tras la aprobación manual de una persona
responsable, promueve la misma versión a **producción**.

**Why this priority**: permite demostrar cada feature a los interesados en cuanto se termina.

**Independent Test**: integrar un cambio trivial (p. ej., el número de versión visible en la
página inicial) y verificar que aparece en staging, y en producción después de aprobar.

**Acceptance Scenarios**:

1. **Given** un cambio integrado en la rama principal, **When** termina el pipeline, **Then** la
   nueva versión está disponible en staging en menos de 20 minutos.
2. **Given** una versión en staging con las pruebas de humo en verde, **When** una persona
   responsable aprueba la promoción, **Then** la misma versión queda disponible en producción.
3. **Given** que las pruebas de humo fallan en staging, **When** termina el pipeline, **Then** la
   promoción a producción queda bloqueada y el equipo recibe la notificación del fallo.

---

### User Story 4 - Reversión segura (Priority: P3)

Ante un despliegue defectuoso, el responsable de operaciones restaura la versión anterior en
menos de 10 minutos, ya sea redesplegando la versión previa o revirtiendo el commit.

**Why this priority**: materializa el requisito de "commits reversibles" en producción.

**Independent Test**: desplegar una versión, revertir su commit y verificar que el entorno
vuelve a mostrar la versión previa y que las migraciones de datos se deshacen sin errores.

**Acceptance Scenarios**:

1. **Given** una versión defectuosa en producción, **When** el responsable ejecuta el
   procedimiento de reversión documentado, **Then** la versión anterior vuelve a estar
   disponible en menos de 10 minutos.
2. **Given** una migración de datos aplicada, **When** se ejecuta su reversión, **Then** el esquema
   vuelve exactamente al estado anterior y los datos que existían antes de la migración se
   conservan.
3. **Given** una migración marcada como destructiva (elimina o transforma datos de forma que su
   reversión no puede reconstruirlos), **When** se va a aplicar en staging o producción, **Then**
   existe un respaldo de la base de datos tomado inmediatamente antes, y la reversión documentada
   incluye la restauración de ese respaldo.

---

### Edge Cases

- Un servicio no arranca en el entorno desplegado: el healthcheck falla y la plataforma lo
  reinicia; tras 3 fallos consecutivos el despliegue se marca como fallido y se conserva la
  versión anterior.
- Falta una variable de entorno obligatoria: el servicio se niega a arrancar y registra
  claramente qué variable falta (sin mostrar su valor).
- Dos PR se integran casi al mismo tiempo: los despliegues se ejecutan en orden, sin pisarse.
- Un secreto se añade por error al repositorio: el pipeline lo detecta y falla.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El repositorio DEBE contener, en un único proyecto, los tres servicios (interfaz
  web, API, servicio analítico) y un paquete de contratos compartidos.
- **FR-002**: El sistema DEBE poder levantarse localmente con un único comando documentado en el
  README, incluyendo base de datos y cola.
- **FR-003**: Cada servicio DEBE exponer un punto de verificación de salud que refleje el estado
  de sus dependencias.
- **FR-004**: Cada servicio DEBE registrar sus eventos en formato estructurado con un
  identificador de petición que se propague entre servicios.
- **FR-005**: Cada servicio DEBE validar al arrancar que tiene su configuración obligatoria.
- **FR-006**: El pipeline de PR DEBE ejecutar: lint y formato, verificación de tipos, pruebas
  unitarias y de integración, construcción de los servicios, validación de mensajes de commit
  y detección de secretos.
- **FR-007**: El pipeline DEBE impedir la integración a la rama principal si alguna etapa falla.
- **FR-008**: La integración a la rama principal DEBE desplegar automáticamente en staging y
  ejecutar pruebas de humo.
- **FR-009**: La promoción a producción DEBE requerir aprobación manual y pruebas de humo en verde.
- **FR-010**: DEBE existir un mecanismo de migraciones de datos con operaciones de aplicar y
  revertir; las migraciones destructivas DEBEN declararse como tales y requerir un respaldo
  previo antes de aplicarse en staging o producción.
- **FR-011**: DEBE existir un mecanismo de *feature flags* configurable por entorno.
- **FR-012**: DEBE generarse automáticamente un changelog y una etiqueta de versión semántica
  en cada release.
- **FR-013**: DEBE existir documentación del procedimiento de reversión y un registro de
  decisiones de arquitectura (ADR).

### Key Entities

- **Servicio**: componente desplegable (web, api, analytics, base de datos, cola), con su
  configuración, su estado de salud y su versión.
- **Entorno**: local, efímero de PR, staging o producción; cada uno con sus propias variables.
- **Migración**: cambio versionado del esquema de datos, con operación de aplicar y revertir.
- **Feature flag**: interruptor con nombre que activa o desactiva una funcionalidad por entorno.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona nueva en el equipo tiene el entorno local funcionando en menos de
  30 minutos siguiendo solo el README.
- **SC-002**: El pipeline de PR completa todas las validaciones en menos de 15 minutos.
- **SC-003**: Un cambio integrado está disponible en staging en menos de 20 minutos.
- **SC-004**: La reversión a la versión anterior en producción toma menos de 10 minutos.
- **SC-005**: El 100 % de los commits de la rama principal cumple el formato Conventional Commits.

## Assumptions

- El código se aloja en GitHub y la plataforma de despliegue es Railway (definido en prompt.md).
- El equipo dispone de cuentas con permisos en GitHub y en Railway, y de un token de Railway
  para el pipeline.
- Los entornos efímeros por PR son deseables pero no bloquean esta feature; si el plan de
  Railway no los permite, se omiten.
- En esta feature los servicios solo exponen salud y una página inicial; la funcionalidad de
  negocio llega en las features 002–008.
