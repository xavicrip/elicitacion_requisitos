---
description: "Task list for feature 002-auth-proyectos"
---

# Tasks: Autenticación, roles y gestión de proyectos

**Input**: Design documents from `/specs/002-auth-proyectos/`
**Prerequisites**: plan.md (incluidos los "Ajustes tras implementar la 001"), spec.md,
research.md, data-model.md, contracts/, quickstart.md

**Tests**: OBLIGATORIAS (Principio III de la constitución). Las pruebas de cada historia se
escriben primero y se verifica que fallan (rojo) antes de implementar. Las de integración usan
MongoDB y Redis reales (`pnpm test:services:up` en local; `services` en CI).

**Commits**: Conventional Commits, un commit atómico por tarea; **cada par prueba +
implementación va en el mismo commit** (Principio IV: todo commit pasa `pnpm test`). El tipo y
alcance sugeridos van al final de cada tarea.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia de usuario de spec.md (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependencias y datos estáticos

- [X] T001 Añadir a `apps/api/package.json` `@fastify/jwt`, `@fastify/cookie`, `@fastify/rate-limit`, `@node-rs/argon2`, `bullmq` y un `fastify-type-provider-zod` compatible con zod 4; comprobar que `docker build -f apps/api/Dockerfile .` sigue por debajo de 300 MB (límite del CI) — `chore(api)`
- [X] T002 [P] Añadir a `apps/web/package.json` `react-router` 7, `@tanstack/react-query` 5, `zustand`, `react-hook-form`, `@hookform/resolvers`, `tailwindcss` 4 y `@tailwindcss/vite`; registrar el plugin en `apps/web/vite.config.ts` y crear `apps/web/src/index.css` con `@import "tailwindcss"` — `chore(web)`
- [X] T003 [P] Añadir la lista de las 10 000 contraseñas más comunes en `apps/api/data/common-passwords.txt` (fuera de `src/`, que el `Dockerfile` elimina de la imagen), con su origen y licencia en la cabecera — `chore(api)`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: configuración, esquemas compartidos, modelos, migración, guards, proxy y
separación de los E2E, que usan todas las historias

**⚠️ CRITICAL**: ninguna historia puede empezar hasta completar esta fase

- [X] T004 [P] Pruebas de `loadEnv` para `JWT_SECRET` (obligatoria, ≥ 32 bytes; el error nombra la variable sin mostrar el valor), `JWT_ACCESS_TTL` (defecto `15m`), `REFRESH_TTL_DAYS` (defecto `7`) y `APP_BASE_URL` (URL obligatoria) en `apps/api/tests/unit/env.test.ts` — `test(api)`
- [X] T005 Implementar las variables de T004 en `apps/api/src/config/env.ts`; añadirlas a `.env.example`, al servicio `api` de `infra/docker-compose.yml` (valores de desarrollo claramente ficticios, `dev-only-…`, añadidos a `.gitleaks.toml` si el CI los marca) y a `specs/001-plataforma-base/contracts/env-vars.md` (solo servicio `api` de Railway, plan ajuste 6) — `feat(api)`
- [X] T006 [P] Pruebas de los esquemas zod `RegisterInput`, `LoginInput`, `SessionUser` y de la política de contraseña (≥ 10 caracteres) en `packages/shared/tests/auth.test.ts`, y de `Project`, `ProjectStatus`, `Role`, `ProjectInput` (nombre 1–100, descripción ≤ 2 000) e `Invitation` en `packages/shared/tests/projects.test.ts` — `test(shared)`
- [X] T007 Implementar `packages/shared/src/auth.ts` y `packages/shared/src/projects.ts` y exportarlos desde `packages/shared/src/index.ts` — `feat(shared)`
- [X] T008 [P] Prueba de integración de la migración (up crea los índices únicos y TTL de data-model.md; down los elimina; `destructive === false`) en `apps/api/tests/integration/auth-projects-migration.test.ts` — `test(api)`
- [X] T009 Crear `apps/api/migrations/20261001000000-auth-projects-indexes.js` con `destructive = false`, `up` y `down` según data-model.md §Migración — `feat(api)`
- [X] T010 [P] Modelos Mongoose sobre la conexión `app.mongo`: `apps/api/src/modules/users/model.ts` (`passwordHash` con `select: false` y excluido de `toJSON`), `apps/api/src/modules/projects/model.ts` (con `deletion: { status: pending|running|done|failed, attempts, error? }`, constitución VI), `apps/api/src/modules/invitations/model.ts`, `apps/api/src/modules/auth/refresh-token.model.ts` y `apps/api/src/modules/audit/model.ts` — `feat(api)`
- [X] T011 [P] Pruebas del servicio de auditoría (`record(action, {actorId, projectId, entity, diff})`, sin secretos en `diff`) en `apps/api/tests/integration/audit.test.ts` — `test(api)`
- [X] T012 Implementar `apps/api/src/modules/audit/service.ts` — `feat(api)`
- [X] T013 Registrar `fastify-type-provider-zod` (validator y serializer) en `apps/api/src/app.ts` y un manejador de errores con el formato `ValidationError` del contrato (`contracts/auth-projects.openapi.yaml`); prueba en `apps/api/tests/unit/validation-errors.test.ts` — `feat(api)`
- [X] T014 [P] Pruebas del plugin de autenticación (`@fastify/jwt` HS256 con `JWT_SECRET`, claims `sub`/`sid`, `requireAuth` → 401 sin token, con token caducado o con firma inválida; `userId` añadido al contexto de log) en `apps/api/tests/unit/auth-plugin.test.ts` — `test(api)`
- [X] T015 Implementar `apps/api/src/plugins/auth.ts` (`@fastify/jwt`, `@fastify/cookie`, decorador `request.user`, `requireAuth`) y añadir `userId` en `apps/api/src/lib/request-context.ts` — `feat(api)`
- [X] T016 [P] Pruebas de `requireProjectRole('member' | 'admin')`: 404 si no es miembro o el proyecto está en `deleting`, 403 si le falta el rol, `request.project` cargado una sola vez, membresía consultada en cada petición (no se cachea en el JWT); y `requireProjectStatus('open')` → `409` si el proyecto no está abierto (para las escrituras de contenido de la 004 y la 005, spec US2 escenario 3) en `apps/api/tests/integration/authorization-guard.test.ts` — `test(api)`
- [X] T017 Implementar `requireProjectRole` y `requireProjectStatus` en `apps/api/src/plugins/authorization.ts` — `feat(api)`
- [X] T018 [P] Pruebas del plugin de rate limit (20 peticiones/min por IP en `/auth/*` con almacén Redis; `429` con `Retry-After`) en `apps/api/tests/integration/rate-limit.test.ts` — `test(api)`
- [X] T019 Implementar `apps/api/src/plugins/rate-limit.ts` (`@fastify/rate-limit` sobre `app.redis`) — `feat(api)`
- [X] T020 [P] Prueba de la comprobación de Redis para BullMQ (si `maxmemory-policy` no es `noeviction`, log `error` al arrancar y `checks.redis.warning` en `/health/deep`) en `apps/api/tests/integration/redis-policy.test.ts` — `test(api)`
- [X] T021 Implementar la comprobación de T020 en `apps/api/src/plugins/redis.ts` y fijar `--maxmemory-policy noeviction` en el Redis de `infra/docker-compose.yml` e `infra/docker-compose.test.yml` (plan, ajuste 7) — `feat(api)`
- [X] T022 [P] Pruebas del proxy en `tests/repo/web-proxy.test.sh`: el `Caddyfile` tiene `handle_path /api/*` con `reverse_proxy {$API_INTERNAL_URL}` antes del `handle` de la SPA; `docker-entrypoint.sh` arranca sin `API_PUBLIC_URL` y falla (código 1, nombrando la variable) sin `API_INTERNAL_URL` — `test(web)`
- [X] T023 Implementar el proxy (plan, ajuste 2) en `apps/web/Caddyfile` y `apps/web/docker-entrypoint.sh` (`API_PUBLIC_URL` opcional); `API_INTERNAL_URL: http://api:3000` en `infra/docker-compose.yml`; `server.proxy['/api']` (quitando el prefijo) en `apps/web/vite.config.ts`; añadir la prueba a `test:repo` en `package.json` y la variable a `contracts/env-vars.md` de la 001 — `feat(web)`
- [X] T024 Separar los E2E (plan, ajuste 4): proyectos `smoke` (`e2e/smoke.spec.ts`) y `flows` (`e2e/flows/**/*.spec.ts`) en `e2e/playwright.config.ts`; `pnpm exec playwright test --project smoke` en `.github/workflows/deploy.yml`; el job `e2e-smoke` de `.github/workflows/ci.yml` ejecuta ambos; helper `e2e/flows/helpers.ts` (registro de un usuario único por prueba vía `/api/auth/register`) — `ci`
- [X] T025 [P] Prueba del cliente HTTP de `web` (rutas relativas `/api`, `Authorization: Bearer` con el token en memoria, un único reintento tras `401` refrescando con `/api/auth/refresh`, peticiones concurrentes comparten un solo refresh) en `apps/web/tests/api-client.test.ts` — `test(web)`
- [X] T026 Implementar `apps/web/src/lib/api-client.ts` y `apps/web/src/lib/auth-store.ts` (Zustand, access token solo en memoria) — `feat(web)`
- [X] T027 Estructura de la app en `apps/web/src/app/router.tsx` (React Router 7 en modo librería, `QueryClientProvider`, layout con Tailwind, ruta raíz que conserva la vista actual con la versión) y `apps/web/src/main.tsx`; actualizar `apps/web/tests/App.test.tsx` — `feat(web)`

- [X] T028 [P] Pruebas del flag `accounts` (constitución IV: funcionalidad incompleta detrás de un flag): registrado en `FLAGS` con `default: false`; con el flag desactivado, `/auth/*`, `/me`, `/projects*` e `/invitations*` responden `404` y `web` no muestra registro ni login (lee los flags de `/api/config`); activado, se comportan con normalidad; en `apps/api/tests/integration/accounts-flag.test.ts` y `apps/web/tests/accounts-flag.test.tsx` — `test(api)`
- [X] T029 Implementar el flag: entrada `accounts` (`owner: 002-auth-proyectos`) en `packages/shared/src/flags.ts` y `docs/feature-flags.md`; hook `requireFlag('accounts')` para los prefijos de rutas de la 002 en `apps/api/src/plugins/flags.ts`; en `web`, rutas y enlaces condicionados en `apps/web/src/app/router.tsx`; `FEATURE_FLAGS=accounts=true` en el job `e2e-smoke` de `.github/workflows/ci.yml` y como valor por defecto de `infra/docker-compose.yml` — `feat(shared)`

**Checkpoint**: fundaciones listas; `pnpm test`, `pnpm e2e --project smoke` y el despliegue siguen en verde

---

## Phase 3: User Story 1 - Registro e inicio de sesión (Priority: P1) 🎯 MVP

**Goal**: una persona se registra, inicia y cierra sesión, y la sesión se renueva sola

**Independent Test**: quickstart.md §1 (registro → "Mis proyectos" vacío → logout → login)

### Tests for User Story 1 ⚠️

- [X] T030 [P] [US1] Pruebas unitarias de `apps/api/src/modules/auth/password.ts` (argon2id con los parámetros de research R3, verificación, rechazo de < 10 caracteres y de contraseñas de `data/common-passwords.txt`) en `apps/api/tests/unit/password.test.ts` — `test(api)`
- [X] T031 [P] [US1] Pruebas unitarias de `apps/api/src/modules/auth/tokens.ts` (access token de 15 min; refresh opaco de 32 bytes guardado solo como hash SHA-256) en `apps/api/tests/unit/tokens.test.ts` — `test(api)`
- [X] T032 [P] [US1] Pruebas de contrato de `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` y `GET /me` contra `contracts/auth-projects.openapi.yaml` (cookie `rt` `httpOnly; SameSite=Strict; Path=/api/auth` y `Secure` salvo en `development`) en `apps/api/tests/contract/auth.contract.test.ts` — `test(api)`
- [X] T033 [P] [US1] Pruebas de integración en `apps/api/tests/integration/auth.test.ts`: email duplicado → `409` genérico con tiempo similar (research R5); los intentos fallidos 1–5 en 15 min (por email o por IP) responden `401` genérico y a partir del 6.º `429` con `Retry-After` durante 15 min y evento `auth.login_failed` en auditoría; rotación del refresh; reutilizar un refresh rotado revoca todo el `sid`; logout revoca la sesión; `passwordHash` nunca aparece en respuestas ni logs — `test(api)`
- [X] T034 [P] [US1] Pruebas de `LoginPage` y `RegisterPage` (validación con los esquemas de `@reqcanvas/shared`, mensaje genérico, redirección a "Mis proyectos") y de la restauración de sesión al cargar en `apps/web/tests/auth.test.tsx` — `test(web)`
- [X] T035 [P] [US1] E2E en `e2e/flows/auth.spec.ts`: registro → "Mis proyectos" vacío; recargar conserva la sesión; logout bloquea las rutas protegidas; 6.º intento fallido muestra el aviso de bloqueo — `test(e2e)`

### Implementation for User Story 1

- [X] T036 [US1] Implementar `apps/api/src/modules/auth/password.ts` (carga la lista de `apps/api/data/` buscándola hacia arriba, como `MIGRATIONS_DIR`) — `feat(api)`
- [X] T037 [US1] Implementar `apps/api/src/modules/auth/tokens.ts` — `feat(api)`
- [X] T038 [US1] Implementar `apps/api/src/modules/auth/service.ts` (registro con hash ficticio si el email existe, login con contadores Redis `login:fail:{emailHash}` y `login:fail:{ip}` (IP de `clientIp`, research R4), rotación y detección de reutilización, logout, `lastLoginAt`) — `feat(api)`
- [X] T039 [US1] Implementar `apps/api/src/modules/auth/routes.ts` y `GET /me`, y registrar los plugins de auth y rate limit y las rutas en `apps/api/src/app.ts` — `feat(api)`
- [X] T040 [US1] Implementar `apps/web/src/features/auth/LoginPage.tsx`, `RegisterPage.tsx`, la ruta protegida (loader que llama a `/api/auth/refresh`), el botón de cierre de sesión y una `ProjectsPage` inicial vacía en `apps/web/src/features/projects/ProjectsPage.tsx` — `feat(web)`

**Checkpoint**: US1 funcional; quickstart §1 en verde con `pnpm dev:up`

---

## Phase 4: User Story 2 - Crear y gestionar proyectos (Priority: P1)

**Goal**: crear, editar, cambiar de estado y eliminar proyectos; "Mis proyectos" con rol,
estado y última actividad

**Independent Test**: quickstart.md §2

### Tests for User Story 2 ⚠️

- [X] T041 [P] [US2] Pruebas de contrato de `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id` y `POST /projects/:id/status` en `apps/api/tests/contract/projects.contract.test.ts` — `test(api)`
- [X] T042 [P] [US2] Pruebas de integración en `apps/api/tests/integration/projects.test.ts`: el creador queda como `admin` en `draft`; transiciones válidas (`open`, `close`, `reopen`) y `409` en las inválidas; auditoría `project.status_changed`; "Mis proyectos" ordenado por `lastActivityAt` con rol y estado, incluida una persona que es `admin` en un proyecto y `participant` en otro (FR-007); p95 < 200 ms con 100 proyectos — `test(api)`
- [X] T043 [P] [US2] Pruebas del borrado en `apps/api/tests/integration/project-deletion.test.ts`: `confirmName` distinto → `400`; correcto → `202`, `status: deleting` (404 para todos) y job `project-deletion` que ejecuta los manejadores de `registerProjectCascade` de forma idempotente y reintentable, registrando `deletion.status` (`pending → running → done`, o `failed` con `attempts` y `error` tras agotar los reintentos; constitución VI) — `test(api)`
- [X] T044 [P] [US2] Pruebas de `ProjectsPage`, `ProjectSettingsPage` y `DeleteProjectDialog` (el botón solo se activa al escribir el nombre exacto); un nombre o descripción con `<script>` se muestra como texto (constitución V, XSS); editar la descripción, forzar un `401` y guardar conserva el texto (edge case de sesión caducada) en `apps/web/tests/projects.test.tsx`; activar `react/no-danger` en `eslint.config.js` si no está — `test(web)`
- [X] T045 [P] [US2] E2E en `e2e/flows/projects.spec.ts`: crear → abrir → cerrar → reabrir → eliminar con confirmación — `test(e2e)`

### Implementation for User Story 2

- [X] T046 [US2] Implementar `apps/api/src/modules/projects/service.ts` (crear, listar, editar, transiciones con auditoría, `lastActivityAt`) — `feat(api)`
- [X] T047 [US2] Implementar `apps/api/src/modules/projects/cascade.ts` (`registerProjectCascade`) y el worker BullMQ `apps/api/src/jobs/project-deletion.ts` (conexión propia con `maxRetriesPerRequest: null`, arranca y se cierra con la app, actualiza `deletion.status` y lo registra en el log) — `feat(api)`
- [X] T048 [US2] Implementar `apps/api/src/modules/projects/routes.ts` con `requireAuth` y `requireProjectRole` y registrarlas en `apps/api/src/app.ts` — `feat(api)`
- [X] T049 [US2] Implementar en `apps/web/src/features/projects/` la lista, el formulario de creación, `ProjectSettingsPage.tsx` (edición y cambios de estado) y `DeleteProjectDialog.tsx` con TanStack Query — `feat(web)`

**Checkpoint**: US1 y US2 funcionan de forma independiente

---

## Phase 5: User Story 4 - Control de acceso por rol (Priority: P1)

**Goal**: nadie ve ni hace más de lo que su rol permite, por URL ni por petición directa

**Independent Test**: quickstart.md §4 y la matriz de autorización en verde (SC-003)

> Se ejecuta antes de la US3 (P2) por prioridad. Cubre las filas de proyectos de
> `contracts/authorization-matrix.md` sembrando miembros directamente en la base de datos; la
> US3 añade las filas de miembros e invitaciones (T056). Las filas del dashboard y de la subida
> de diagramas (spec US4 escenario 2) las añaden la 007 y la 003 a la misma matriz.

### Tests for User Story 4 ⚠️

- [X] T050 [US4] Matriz parametrizada (anónimo, no miembro, participante, administrador × filas de proyectos de `contracts/authorization-matrix.md`, más proyecto en `deleting`) en `apps/api/tests/integration/authorization.matrix.test.ts`, con un helper de siembra en `apps/api/tests/helpers/seed.ts`, y las correcciones que requiera en `apps/api/src/modules/projects/routes.ts` y `apps/api/src/plugins/authorization.ts` (un solo commit; si la matriz pasa a la primera, se registra en el mensaje) — `test(api)`
- [X] T051 [P] [US4] Pruebas de `web`: un proyecto inexistente o ajeno muestra "Proyecto no encontrado"; un participante no ve las acciones de administración en `apps/web/tests/access-control.test.tsx` — `test(web)`
- [X] T052 [P] [US4] E2E en `e2e/flows/access-control.spec.ts`: una segunda cuenta que abre la URL de un proyecto ajeno ve "no encontrado" y la API responde `404` por petición directa — `test(e2e)`

### Implementation for User Story 4

- [X] T053 [US4] Implementar en `web` la vista "Proyecto no encontrado" (`apps/web/src/features/projects/ProjectNotFound.tsx`) y ocultar las acciones de administración según `role` en `apps/web/src/features/projects/` — `feat(web)`

**Checkpoint**: las filas de proyectos de la matriz, al 100 % en verde

---

## Phase 6: User Story 3 - Invitar participantes (Priority: P2)

**Goal**: enlaces de invitación multiuso de 7 días; el Administrador gestiona miembros y roles

**Independent Test**: quickstart.md §3

### Tests for User Story 3 ⚠️

- [X] T054 [P] [US3] Pruebas de contrato de `/projects/:id/members[/:uid]`, `/projects/:id/invitations[/:iid]`, `GET /invitations/:token` y `POST /invitations/:token/accept` en `apps/api/tests/contract/invitations.contract.test.ts` — `test(api)`
- [X] T055 [P] [US3] Pruebas de integración en `apps/api/tests/integration/invitations.test.ts`: el token solo se devuelve al crear y se guarda como hash; caducada o revocada → `410`; aceptar es idempotente (no duplica, conserva el rol); retirar al último admin, degradarlo o que abandone → `409`; un miembro retirado pierde el acceso en la siguiente petición y no se borran su usuario ni los documentos que lo referencian (`audit_logs.actorId`; la 004 añade el caso con aportes); auditoría `member.role_changed`, `member.removed`, `invitation.created`, `invitation.revoked` — `test(api)`
- [X] T056 [P] [US3] Ampliar `apps/api/tests/integration/authorization.matrix.test.ts` con las filas de miembros e invitaciones (incluidos los `409`) — `test(api)`
- [X] T057 [P] [US3] Pruebas de `MembersPanel` (cambiar rol, retirar, generar, copiar y revocar enlaces) y de `AcceptInvitationPage` (sin sesión: registro y unión conservando el token; inválida: "Esta invitación ya no es válida") en `apps/web/tests/invitations.test.tsx` — `test(web)`
- [X] T058 [P] [US3] E2E en `e2e/flows/invitations.spec.ts` (dos contextos de navegador): generar enlace → registrarse desde el enlace → el proyecto aparece como Participante; el participante no puede crear invitaciones (`403`); revocar → tercera cuenta ve el mensaje; retirar → el participante deja de ver el proyecto — `test(e2e)`

### Implementation for User Story 3

- [X] T059 [US3] Implementar `apps/api/src/modules/invitations/service.ts` y `routes.ts` (token de 32 bytes en base64url, URL con `APP_BASE_URL` + `/invitacion/{token}`; flag `invite-email` registrado en `packages/shared/src/flags.ts` con `default: false`) — `feat(api)`
- [X] T060 [US3] Implementar la gestión de miembros en `apps/api/src/modules/projects/members.ts` (actualizaciones condicionales atómicas para "≥ 1 admin", research R6) y sus rutas — `feat(api)`
- [X] T061 [US3] Implementar `apps/web/src/features/projects/MembersPanel.tsx` y `apps/web/src/features/invitations/AcceptInvitationPage.tsx` (ruta `/invitacion/:token`) — `feat(web)`

**Checkpoint**: las cuatro historias funcionan; la matriz completa, al 100 % en verde (SC-003)

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T062 [P] ADR `docs/adr/0004-sesion-y-proxy.md` (research R1, R2 y plan ajustes 2–4) — `docs(adr)`
- [X] T063 [P] Actualizar `specs/002-auth-proyectos/quickstart.md` (servicios de prueba, `pnpm --filter @reqcanvas/api test`, `pnpm e2e --project flows`) y el README (variables nuevas y pantallas) — `docs(repo)`
- [X] T064 Medir en local el p95 de `POST /auth/login` (< 300 ms) y de "Mis proyectos" con 100 proyectos (< 200 ms) y anotarlo en `plan.md` — `perf(api)`
- [X] T065 Configurar Railway **antes de desplegar** (con el selector de entorno comprobado): `JWT_SECRET` (generado por entorno), `JWT_ACCESS_TTL`, `REFRESH_TTL_DAYS` y `APP_BASE_URL` en `api`; `API_INTERNAL_URL=http://api.railway.internal:3000` en `web`; `FEATURE_FLAGS=accounts=true` solo en `staging`; verificar `maxmemory-policy noeviction` en Redis con `/health/deep` (T021); registrarlo en `docs/adr/0002-despliegue-railway.md` — `docs(infra)`
- [X] T066 Recorrer quickstart.md en staging (§1–4) con dos navegadores, repetir las mediciones de T064, comprobar que el bloqueo por IP distingue clientes (el borde de Railway pone `X-Real-IP`, research R4) y registrar el resultado en `specs/002-auth-proyectos/quickstart.md` — `docs(repo)`
- [X] T067 Activar `accounts` por defecto (`default: true` en `packages/shared/src/flags.ts`) cuando las cuatro historias y T066 estén en verde, para que entre en la siguiente release; retirar el flag y sus comprobaciones en un commit posterior y separado (constitución IV) — `feat(shared)`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → historias.
- **US1 (P1)**: tras la Phase 2. Base de las demás (sesión y "Mis proyectos").
- **US2 (P1)**: tras US1 (usa la sesión y amplía `ProjectsPage`).
- **US4 (P1)**: tras US2 (sus filas cubren los endpoints de proyectos).
- **US3 (P2)**: tras US4 (amplía la matriz con sus filas en T056).
- **Polish**: al final; T065 antes del primer despliegue a staging que incluya T005 (sin `JWT_SECRET`, `api` no arranca y Railway mantiene la versión anterior). T067 es la última tarea: hasta entonces, producción no expone la funcionalidad aunque el código esté en una release.

### Within Each User Story

- Pruebas (en rojo) → implementación (en verde) → refactor; cada par se integra en un commit.
- Modelos (Phase 2) → servicios → rutas → `web` → E2E en verde.

### Parallel Opportunities

- Phase 1: T002 y T003 en paralelo con T001.
- Phase 2: los pares T004–T005, T006–T007, T008–T009, T011–T012, T014–T015, T016–T017, T018–T019, T020–T021, T022–T023, T025–T026 y T028–T029 son independientes entre sí; T010 en paralelo con todos ellos.
- Cada historia: todas sus pruebas [P] a la vez; en la US1, T036 y T037 en paralelo.

## Parallel Example: User Story 1

```bash
# Pruebas en paralelo (deben fallar):
Task: "Pruebas de password.ts en apps/api/tests/unit/password.test.ts"
Task: "Pruebas de tokens.ts en apps/api/tests/unit/tokens.test.ts"
Task: "Contrato de /auth/* y /me en apps/api/tests/contract/auth.contract.test.ts"
Task: "Integración de auth en apps/api/tests/integration/auth.test.ts"
Task: "LoginPage y RegisterPage en apps/web/tests/auth.test.tsx"
Task: "E2E en e2e/flows/auth.spec.ts"

# Implementación en paralelo:
Task: "password.ts en apps/api/src/modules/auth/password.ts"
Task: "tokens.ts en apps/api/src/modules/auth/tokens.ts"
```

## Implementation Strategy

### MVP First

1. Phases 1 y 2 → 2. US1 → **validar con quickstart §1** → desplegar a staging (T065 antes).

### Incremental Delivery

US2 → US4 → US3, cada una desplegable en staging por separado (con `accounts=true` solo en
staging). Producción recibe el código en cada release, pero la funcionalidad solo se activa con
T067, al completar las cuatro historias (la US3 es necesaria para el uso colaborativo).

## Notes

- Tareas totales: 67 (Setup 3, Foundational 26, US1 11, US2 9, US4 4, US3 8, Polish 6).
- Cambios tras `/speckit-analyze`: C1 → flag `accounts` (T028, T029, T067); C2 → T010, T043, T047;
  C3 y U4 → T044; A1 → T033; A2 → T055; U1 → T016, T017; U2 y I3 → US4 (T050); U3 → T059;
  I4 → T005; X1 → T042.
- Nunca integrar un commit que rompa `pnpm test` (Principio IV).
- T065 requiere acceso a Railway y lo hace el propietario del proyecto; el resto no requiere
  permisos externos.
