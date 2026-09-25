<!--
Sync Impact Report
- Version change: plantilla (sin versión) → 1.0.0
- Principios definidos (nuevos):
  I. Requisito anclado a la actividad
  II. Servicios desacoplados con contratos compartidos
  III. Pruebas primero (NO NEGOCIABLE)
  IV. Commits atómicos y reversibles (NO NEGOCIABLE)
  V. Seguridad por defecto
  VI. Observabilidad y operabilidad
  VII. Humano en el bucle y simplicidad
- Secciones añadidas: Restricciones tecnológicas y de despliegue; Flujo de desarrollo y quality gates
- Secciones eliminadas: ninguna
- Plantillas revisadas:
  ✅ .specify/templates/plan-template.md (la "Constitution Check" se deriva de este archivo; sin cambios)
  ✅ .specify/templates/spec-template.md (sin secciones obligatorias nuevas)
  ✅ .specify/templates/tasks-template.md (las pruebas pasan a ser obligatorias por el Principio III;
     cada tasks.md generado DEBE incluir tareas de prueba)
- TODOs diferidos: ninguno
-->

# ReqCanvas Constitution

## Core Principles

### I. Requisito anclado a la actividad

- Todo detalle de requisito DEBE pertenecer a exactamente una actividad de un diagrama publicado.
- Todo detalle DEBE contener los tres componentes del escenario: **Dado** (contexto),
  **Cuando** (acción) y **Entonces** (resultado). No se aceptan detalles con componentes vacíos.
- La autoría, la fecha y cada modificación de un detalle DEBEN quedar registradas (trazabilidad).

**Razón:** el valor del producto es reducir la ambigüedad y medir la cobertura del proceso;
un requisito sin actividad o sin escenario completo no se puede analizar ni validar.

### II. Servicios desacoplados con contratos compartidos

- El sistema se compone de servicios independientes (`web`, `api`, `analytics`) que se
  comunican solo mediante contratos explícitos (HTTP/OpenAPI, eventos de WebSocket, colas).
- Los tipos y esquemas de validación compartidos viven en `packages/shared` y son la única
  fuente de verdad de los contratos entre `web` y `api`.
- Los servicios DEBEN ser stateless; el estado persiste en MongoDB, Redis o el almacenamiento
  de objetos.
- Un servicio NO DEBE leer ni escribir directamente las colecciones de las que otro servicio
  es dueño, salvo las que se declaren como compartidas en el `data-model.md` de la feature.

**Razón:** permite desplegar, escalar y revertir cada servicio en Railway por separado.

### III. Pruebas primero (NO NEGOCIABLE)

- Cada historia de usuario DEBE tener pruebas automatizadas escritas antes de su
  implementación, que fallen primero y luego pasen (Red-Green-Refactor).
- Todo contrato (endpoint REST, evento de WebSocket o endpoint del servicio analítico) DEBE
  tener una prueba de contrato.
- La cobertura mínima es del 70 % en `api` y `analytics`; los flujos críticos de `web` DEBEN
  tener pruebas E2E.
- Ningún cambio se integra a `main` con el pipeline de CI en rojo.

**Razón:** los commits atómicos y reversibles solo son seguros si cada commit está respaldado
por pruebas que detecten regresiones.

### IV. Commits atómicos y reversibles (NO NEGOCIABLE)

- Cada commit contiene un único cambio lógico, compila y pasa las pruebas por sí solo.
- Los mensajes siguen Conventional Commits (`feat`, `fix`, `test`, `docs`, `chore`,
  `refactor`, `ci`), con el alcance del servicio o módulo afectado.
- Cualquier commit DEBE poder revertirse con `git revert` sin romper `main`:
  - Las migraciones de datos tienen `up` y `down`.
  - Las funcionalidades incompletas se integran detrás de *feature flags*.
  - Los cambios de contrato son aditivos; las eliminaciones se hacen en un commit posterior
    y separado.
- El flujo de ramas es trunk-based, con ramas cortas por feature (`NNN-nombre`), y los PR
  conservan los commits (sin squash).

**Razón:** es un requisito explícito del proyecto y la base de un rollback seguro.

### V. Seguridad por defecto

- La autorización se verifica **siempre en el servidor**, por proyecto y por rol
  (Administrador / Participante); la interfaz nunca es la única barrera.
- Todas las entradas externas se validan con esquemas y todo texto de usuario se sanea antes
  de mostrarse (prevención de XSS).
- Contraseñas con hash robusto (argon2 o bcrypt), tokens de corta duración, cookies `httpOnly`,
  rate limiting en los endpoints de autenticación y CORS restringido.
- Los secretos solo existen en variables de entorno de Railway o de GitHub; nunca en el
  repositorio.
- Los archivos subidos se validan por tipo MIME real y tamaño antes de almacenarse.

**Razón:** la aplicación guarda información de negocio aportada por terceros.

### VI. Observabilidad y operabilidad

- Cada servicio expone `GET /health`, que responde `200` cuando sus dependencias están
  disponibles.
- Logs estructurados en JSON con `requestId` propagado entre servicios.
- Los errores al usuario son mensajes claros en español; los detalles técnicos solo van al log.
- Los trabajos asíncronos (detección, análisis) registran su estado consultable
  (`pending`, `running`, `done`, `failed`).

**Razón:** en Railway, los logs y los healthchecks son las principales herramientas de
diagnóstico y de reinicio automático.

### VII. Humano en el bucle y simplicidad

- Todo resultado automático (actividades detectadas en la imagen, duplicados, clusters,
  insights generados por IA) es una **propuesta** que el administrador puede aceptar, corregir
  o descartar; nunca modifica datos confirmados sin acción humana.
- Los insights generados por IA DEBEN indicar en qué datos se basan.
- Se prefiere la solución más simple que cumpla la spec (YAGNI); cualquier complejidad
  adicional se justifica en la sección *Complexity Tracking* del plan.

**Razón:** la detección por visión y la minería de texto son imperfectas; la confianza en el
sistema depende de que el analista mantenga el control.

## Restricciones tecnológicas y de despliegue

- **Frontend:** React + TypeScript + Vite; el canvas se implementa con **three.js**
  (vía `@react-three/fiber`).
- **Backend:** Node.js LTS + TypeScript, con Socket.IO para el tiempo real.
- **Servicio analítico:** Python 3.12 + FastAPI para OCR, visión y minería de datos y texto.
- **Persistencia:** **MongoDB** como base de datos principal; Redis para colas y pub/sub;
  almacenamiento de objetos compatible con S3 para imágenes.
- **Despliegue:** **Railway**, un servicio por componente, cada uno con su `Dockerfile`,
  healthcheck y política de reinicio; entornos `staging` y `production`.
- **Monorepo:** pnpm workspaces (`apps/*`, `packages/*`).
- **Idioma:** la interfaz y los mensajes al usuario están en español.
- Introducir una tecnología fuera de esta lista requiere un ADR en `docs/adr/`.

## Flujo de desarrollo y quality gates

1. Cada funcionalidad sigue el flujo de spec-kit: `specify` → (`clarify`) → `plan` →
   `tasks` → (`analyze`) → `implement`.
2. El plan de cada feature DEBE pasar la *Constitution Check* antes de generar tareas.
3. Gates de CI obligatorios en cada PR: lint, verificación de tipos, pruebas unitarias,
   de contrato e integración, build de imágenes Docker y validación de mensajes de commit
   (commitlint).
4. `main` se despliega automáticamente en `staging`; la promoción a `production` requiere
   smoke tests en verde y aprobación manual.
5. Cada PR requiere al menos una revisión que verifique el cumplimiento de esta constitución.

## Governance

- Esta constitución prevalece sobre cualquier otra práctica o guía del proyecto.
- Las enmiendas se proponen mediante un PR que modifique este archivo, incluyan el
  *Sync Impact Report* actualizado y el plan de migración si afectan código existente.
- Versionado semántico: MAJOR para eliminar o redefinir principios, MINOR para añadir
  principios o secciones, PATCH para aclaraciones de redacción.
- Cada revisión de PR y cada `/speckit-analyze` verifica el cumplimiento; las violaciones
  deben justificarse en *Complexity Tracking* o corregirse.
- La guía operativa para agentes está en `CLAUDE.md`.

**Version**: 1.0.0 | **Ratified**: 2026-09-25 | **Last Amended**: 2026-09-25
