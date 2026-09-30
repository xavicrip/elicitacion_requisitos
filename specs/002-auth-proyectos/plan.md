# Implementation Plan: Autenticación, roles y gestión de proyectos

**Branch**: `002-auth-proyectos` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-auth-proyectos/spec.md`

## Summary

Añadir cuentas de usuario (registro, login y logout) con contraseñas argon2id, un access token
JWT de 15 minutos en memoria y un refresh token rotativo en cookie `httpOnly`. Se crean los
proyectos de levantamiento, con miembros embebidos (rol por proyecto), estados
*borrador/abierto/cerrado* e invitaciones por enlace multiuso con caducidad de 7 días. La
autorización se aplica en el servidor mediante un *guard* reutilizable (`requireProjectRole`),
que las features 003–008 reutilizan. Para que la cookie funcione en todos los navegadores,
`web` actúa como **proxy inverso** de la API (`/api/*`) a través de la red privada de Railway,
de modo que frontend y API comparten origen.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 24 LTS
**Primary Dependencies**: `api`: Fastify 5, `fastify-type-provider-zod`, `@fastify/jwt`, `@fastify/cookie`, `@fastify/rate-limit` (almacén Redis), `@node-rs/argon2`, Mongoose 9 (driver `mongodb` 7, los de la 001), BullMQ. `web`: React Router 7 (modo librería), TanStack Query 5, Zustand, react-hook-form + zod, Tailwind CSS 4
**Storage**: MongoDB (`users`, `projects`, `invitations`, `refresh_tokens`, `audit_logs`); Redis (contadores de intentos, rate limit, cola `project-deletion`)
**Testing**: Vitest + `fastify.inject` (unitarias, contrato, integración con MongoDB/Redis reales: `pnpm test:services:up` en local, `services` en CI); Playwright: E2E funcionales de registro, invitación y acceso denegado **solo contra el stack local/CI**, separados del smoke post-despliegue (ver ajustes)
**Target Platform**: Railway (contenedores Linux) + navegadores de escritorio y móviles actuales
**Project Type**: Aplicación web (monorepo de la feature 001)
**Performance Goals**: login p95 < 300 ms (argon2id con ~50 ms de coste); "Mis proyectos" p95 < 200 ms con 100 proyectos
**Medido (T064, 2026-09-30)**: en local (Apple Silicon, Docker Compose, a través del proxy de `web`, 50 peticiones): login p50 26 ms / p95 28 ms; "Mis proyectos" con 100 proyectos p50 4 ms / p95 5 ms. Repetir en staging (T066): la CPU de Railway es más lenta, sobre todo para argon2id
**Constraints**: autorización siempre en el servidor; los no miembros reciben 404; sin secretos en logs; todo proyecto con ≥ 1 Administrador
**Scale/Scope**: hasta 5 000 usuarios y 1 000 proyectos en la v1; 6 pantallas nuevas en `web`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento | Estado |
|-----------|--------------|--------|
| I. Requisito anclado a la actividad | No aplica directamente; el control de acceso por proyecto protege los requisitos futuros. | ✅ N/A |
| II. Servicios desacoplados | Todo vive en `api`; esquemas en `packages/shared/src/{auth,projects}.ts`; contrato en `contracts/auth-projects.openapi.yaml`. `analytics` no accede a estas colecciones. | ✅ |
| III. Pruebas primero | Pruebas de contrato por endpoint, pruebas de autorización (matriz rol × endpoint) y E2E de los flujos P1 antes de implementar. | ✅ |
| IV. Commits atómicos y reversibles | Migración `up/down` de índices; cambios de contrato aditivos; el proxy `/api` se añade sin retirar el dominio público de `api` (se retira más adelante, en un commit separado). | ✅ |
| V. Seguridad por defecto | argon2id, JWT de corta duración, refresh rotativo con detección de reutilización, cookie `httpOnly; Secure; SameSite=Strict`, rate limiting, bloqueo tras 5 intentos, respuestas 404 a no miembros, tokens de invitación con hash. | ✅ |
| VI. Observabilidad | Eventos de seguridad en `audit_logs` y en logs (sin PII sensible); `userId` añadido al contexto de log. | ✅ |
| VII. Simplicidad | Miembros embebidos en el proyecto (actualización atómica de la regla "≥ 1 Admin"); sin proveedor externo de identidad en la v1. | ✅ |
| Restricciones (v1.1.0) | Node.js 24; despliegue desde GitHub Actions (sin cambios en el pipeline, salvo nuevas variables `JWT_*`). | ✅ |

**Re-evaluación post-diseño**: sin violaciones. El proxy inverso en `web` modifica un artefacto
de la 001 (Caddyfile), de forma aditiva.

## Project Structure

### Documentation (this feature)

```text
specs/002-auth-proyectos/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── auth-projects.openapi.yaml
│   └── authorization-matrix.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared/src/
├── auth.ts                     # RegisterInput, LoginInput, SessionUser, políticas de contraseña
└── projects.ts                 # Project, ProjectStatus, Role, Invitation (esquemas zod)
apps/api/
├── src/
│   ├── plugins/
│   │   ├── auth.ts             # @fastify/jwt + decorador request.user
│   │   ├── rate-limit.ts       # @fastify/rate-limit con Redis
│   │   └── authorization.ts    # requireAuth, requireProjectRole('admin'|'member')
│   ├── modules/
│   │   ├── auth/{routes,service,tokens,password}.ts
│   │   ├── users/model.ts
│   │   ├── projects/{routes,service,model}.ts
│   │   ├── invitations/{routes,service,model}.ts
│   │   └── audit/{service,model}.ts
│   └── jobs/project-deletion.ts # Worker BullMQ para el borrado en cascada
├── data/common-passwords.txt   # fuera de src/: el Dockerfile elimina src/ de la imagen
├── migrations/20261001000000-auth-projects-indexes.js
└── tests/{unit,contract,integration}/{auth,projects,invitations,authorization}.*.test.ts
apps/web/
├── Caddyfile                   # + reverse_proxy /api/* → api.railway.internal
└── src/
    ├── app/router.tsx
    ├── lib/{api-client.ts,auth-store.ts}
    ├── features/auth/{LoginPage,RegisterPage}.tsx
    ├── features/projects/{ProjectsPage,ProjectSettingsPage,MembersPanel,DeleteProjectDialog}.tsx
    └── features/invitations/AcceptInvitationPage.tsx
e2e/flows/{auth,projects,access-control,invitations}.spec.ts   # proyecto `flows` (ajuste 4)
```

**Structure Decision**: módulos por dominio dentro de `apps/api/src/modules/` (rutas, servicio y
modelo juntos), que es el patrón que seguirán las features 003–008. En `web`, carpetas por
feature bajo `src/features/`.

## Ajustes tras implementar la 001 (2026-09-30)

El plan se escribió antes de implementar la 001. Revisado contra el código de `v0.2.0`:

1. **Dependencias reales**: Mongoose 9, `mongodb` 7 y zod 4 (no Mongoose 8). El *type provider*
   de Fastify debe ser una versión compatible con zod 4. BullMQ abre sus propias conexiones
   Redis con `maxRetriesPerRequest: null`; no reutiliza el cliente `ioredis` del plugin `redis`.
2. **Proxy `/api` en Caddy**: `handle_path /api/*` (quita el prefijo) → `reverse_proxy
   {$API_INTERNAL_URL}`. Nueva variable de `web`: `API_INTERNAL_URL`
   (`http://api.railway.internal:3000` en Railway, `http://api:3000` en Compose); en
   desarrollo con Vite, `server.proxy['/api']`. Las rutas de `api` **no** llevan el prefijo
   `/api` (`/auth/login`, `/projects`…) y `/health`, `/version` siguen en la raíz: `deploy.yml`
   las consulta por el dominio público de `api`, que se mantiene. `/socket.io/*` se añade en la
   005, no ahora.
3. **Cookie `rt`**: `Secure` salvo con `NODE_ENV=development` (Compose sirve por `http`);
   `Path=/api/auth` es la ruta vista por el navegador, así que es correcta con el proxy.
4. **E2E sin datos en producción**: el smoke de `deploy.yml` ejecuta todo `e2e/`. Se separan dos
   proyectos de Playwright: `smoke` (`e2e/smoke.spec.ts`, solo lectura; el único que corre tras
   desplegar, con `--project smoke`) y `flows` (`e2e/flows/*.spec.ts`: registro, invitaciones,
   acceso denegado), que solo corre contra el stack local y el job `e2e-smoke` del CI.
5. **Migración** `20261001000000-auth-projects-indexes.js`: `destructive = false` (solo crea
   colecciones e índices; `down` los elimina), así que el pre-deploy `migrate.js auto` no
   necesita respaldo. Rollback compatible: `v0.2.0` ignora las colecciones nuevas, por lo que el
   Rollback del panel de Railway es seguro (ADR 0003).
6. **Variables** (R11): `JWT_SECRET`, `JWT_ACCESS_TTL`, `REFRESH_TTL_DAYS` y `APP_BASE_URL` van
   **solo en el servicio `api` de Railway** (no en los GitHub Environments: el pipeline no las
   usa). `JWT_SECRET` se genera por entorno y debe existir **antes** del primer despliegue que
   la exija (si falta, `api` no arranca y Railway mantiene la versión anterior).
7. **Redis para BullMQ**: BullMQ exige `maxmemory-policy noeviction`. Verificar la plantilla
   Redis de Railway (8.2) en ambos entornos y el Redis de Compose y de CI antes de implementar
   R9.
8. **Flag `accounts`** (constitución IV, `/speckit-analyze` C1): las historias se integran en
   `main` una a una, así que toda la funcionalidad de la 002 queda detrás del flag `accounts`
   (`default: false`). Con el flag desactivado, las rutas nuevas de `api` responden `404` y
   `web` no muestra registro ni login. Se activa en staging con `FEATURE_FLAGS`, y en
   producción (`default: true`) al completar las cuatro historias; el flag se retira después.
9. **Estado del borrado** (constitución VI, `/speckit-analyze` C2): el job `project-deletion`
   registra `projects.deletion.status` (`pending`, `running`, `done`, `failed`), `attempts` y
   `error`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Cola BullMQ para borrar proyectos | La MongoDB de Railway es un nodo sin transacciones garantizadas y el borrado afecta a varias colecciones (y a archivos a partir de la 003) | Un borrado síncrono en la petición puede dejar datos a medias si falla o expira; el job es idempotente y reintentable |
