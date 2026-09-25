---
description: "Task list for feature 001-plataforma-base"
---

# Tasks: Plataforma base y entrega continua

**Input**: Design documents from `/specs/001-plataforma-base/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: OBLIGATORIAS (Principio III de la constitución). Las pruebas de cada historia se
escriben primero y se verifica que fallan (rojo) antes de implementar. Prueba e implementación
son tareas separadas para ordenar el trabajo.

**Commits**: un commit atómico con formato Conventional Commits por tarea; **cada par
prueba + implementación se commitea junto** (el mensaje cita ambas tareas), porque el
Principio IV exige que cada commit pase las pruebas por sí solo (un commit con la prueba en
rojo rompería `git revert` y `git bisect`). El tipo y alcance sugeridos van al final de cada
tarea, p. ej. `feat(api)`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia de usuario de spec.md (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: esqueleto del monorepo y herramientas de calidad

- [X] T001 Crear `package.json` raíz (private, `packageManager: pnpm@10`, `engines.node: ">=24 <25"`) y `pnpm-workspace.yaml` con `apps/web`, `apps/api`, `packages/shared` — `chore(repo)`
- [X] T002 [P] Añadir `.gitignore`, `.editorconfig`, `.nvmrc` (24) y `.python-version` (3.12) en la raíz — `chore(repo)`
- [X] T003 [P] Configurar TypeScript base en `tsconfig.base.json` (strict, ES2023, `moduleResolution: bundler`) — `chore(repo)`
- [X] T004 [P] Configurar ESLint (flat config) en `eslint.config.js` y Prettier en `.prettierrc` + `.prettierignore` — `chore(lint)`
- [X] T005 [P] Configurar commitlint (`@commitlint/config-conventional`, scopes: repo, web, api, analytics, shared, infra, ci, docs, specs, speckit) en `commitlint.config.cjs` — `chore(repo)`
- [X] T006 Instalar Husky + lint-staged: hooks `commit-msg` (commitlint) y `pre-commit` (lint-staged) en `.husky/` — `chore(repo)`
- [X] T007 [P] Crear `packages/shared` (`package.json`, `tsconfig.json`, `src/index.ts`, Vitest) — `chore(shared)`
- [X] T008 [P] Crear `apps/api` con Fastify 5, TypeScript y Vitest (`package.json` con los scripts `dev` (tsx watch), `build`, `start` (`node dist/server.js`) y `test`; `tsconfig.json`, `vitest.config.ts`, `src/app.ts`, `src/server.ts`) — `chore(api)`
- [X] T009 [P] Crear `apps/web` con Vite + React + TypeScript + `three`, `@react-three/fiber` y Vitest (`apps/web/package.json`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`) — `chore(web)`
- [X] T010 [P] Crear `apps/analytics` con uv: `pyproject.toml` (fastapi, uvicorn, pydantic-settings, motor, redis, python-json-logger; dev: pytest, pytest-cov, httpx, ruff, mypy) y `src/analytics/main.py` — `chore(analytics)`
- [X] T011 Añadir scripts raíz en `package.json`: `lint`, `format:check`, `typecheck`, `test`, `test:py`, `dev:up`, `dev:down` — `chore(repo)`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contratos compartidos, flags, configuración, logging y migraciones que usan todas
las historias

**⚠️ CRITICAL**: ninguna historia puede empezar hasta completar esta fase

- [X] T012 [P] Prueba unitaria del esquema de salud en `packages/shared/tests/health.test.ts` (valida los ejemplos de `contracts/health.openapi.yaml`, incluido `/health/deep`) — `test(shared)`
- [X] T013 Implementar el esquema zod `HealthSchema` y los tipos en `packages/shared/src/health.ts` — `feat(shared)`
- [X] T014 [P] Prueba unitaria de la resolución de flags (default, sobrescritura, nombre desconocido → aviso) en `packages/shared/tests/flags.test.ts` — `test(shared)`
- [X] T015 Implementar el registro de flags y `resolveFlags(env)` en `packages/shared/src/flags.ts` — `feat(shared)`
- [X] T016 Implementar `apps/api/src/lib/flags.ts` (lee `FEATURE_FLAGS` con `resolveFlags` y expone los flags activos) y documentar cómo crear un flag en `docs/feature-flags.md` — `feat(api)`
- [X] T017 [P] Prueba unitaria de la validación de entorno de la API (falta `MONGO_URL` → error que nombra la variable sin su valor) en `apps/api/tests/unit/env.test.ts` — `test(api)`
- [X] T018 Implementar `apps/api/src/config/env.ts` con zod según `contracts/env-vars.md` — `feat(api)`
- [X] T019 [P] Prueba unitaria de la configuración de analytics en `apps/analytics/tests/unit/test_config.py` — `test(analytics)`
- [X] T020 Implementar `apps/analytics/src/analytics/config.py` con pydantic-settings — `feat(analytics)`
- [X] T021 [P] Prueba de integración de requestId en `apps/api/tests/integration/request-id.test.ts`: la API reutiliza o genera `x-request-id`, lo devuelve, lo incluye en el log **y lo reenvía en las llamadas salientes del cliente interno** (verificado con un servidor `analytics` simulado) — `test(api)`
- [X] T022 Implementar el plugin de requestId + logger pino (redacción de secretos) en `apps/api/src/plugins/observability.ts` y el cliente HTTP interno que reenvía `x-request-id` en `apps/api/src/lib/http-client.ts` — `feat(api)`
- [X] T023 [P] Prueba de `request_id` y logs JSON de analytics (reutiliza la cabecera entrante y la incluye en cada línea) en `apps/analytics/tests/unit/test_logging.py` — `test(analytics)`
- [X] T024 Implementar el middleware de `request_id` y los logs JSON en `apps/analytics/src/analytics/logging.py` — `feat(analytics)`
- [X] T025 Registrar `@fastify/helmet` y `@fastify/cors` (desde `CORS_ORIGINS`) en `apps/api/src/app.ts` — `feat(api)`
- [X] T026 [P] Pruebas de migraciones en `apps/api/tests/integration/migrations.test.ts` (`up → down → up` de la migración inicial) y de política en `apps/api/tests/unit/migrations-policy.test.ts` (falla si una migración no exporta `destructive` o no implementa `down`) — `test(api)`
- [X] T027 Configurar migrate-mongo (`apps/api/migrate-mongo-config.js` para `migrate:create`; CLI propio `apps/api/src/db/cli.ts` con lock para `migrate:up|down|status`), la plantilla `apps/api/migrations/sample-migration.js` (con `destructive`) y la migración `apps/api/migrations/20260925000000-init-indexes.js` según data-model.md — `feat(api)`

**Checkpoint**: fundaciones listas

---

## Phase 3: User Story 1 - Entorno local reproducible (Priority: P1) 🎯 MVP

**Goal**: `pnpm dev:up` levanta los 5 servicios y todos responden "saludable"

**Independent Test**: quickstart.md, pasos 1 a 4

### Tests for User Story 1 ⚠️

- [ ] T028 [P] [US1] Prueba de contrato de `GET /health`, `GET /health/deep`, `GET /version` y `GET /config` de la API contra `contracts/health.openapi.yaml` en `apps/api/tests/contract/health.contract.test.ts` — `test(api)`
- [ ] T029 [P] [US1] Prueba de integración en `apps/api/tests/integration/health.test.ts`: `/health` → `200 ok` con Mongo y Redis arriba y `503 degraded` con Mongo caído (sin depender de analytics); `/health/deep` → `503` con analytics caído, y reenvía `x-request-id` a analytics — `test(api)`
- [ ] T030 [P] [US1] Pruebas de contrato e integración de `/health` y `/version` de analytics en `apps/analytics/tests/contract/test_health.py` — `test(analytics)`
- [ ] T031 [P] [US1] Prueba del componente `App` (muestra "ReqCanvas" y la versión) en `apps/web/tests/App.test.tsx` y prueba de shell del arranque de `web` en `apps/web/tests/entrypoint.test.sh` (sin `API_PUBLIC_URL` termina con código 1 e indica la variable sin mostrar valores; con ella genera `/config.js`) — `test(web)`
- [ ] T032 [P] [US1] Smoke de Playwright en `e2e/smoke.spec.ts` y `e2e/playwright.config.ts`: página inicial, `web /health` y `api /health/deep` (que verifica analytics por la red privada), parametrizado por `BASE_URL` y `API_URL` — `test(e2e)`

### Implementation for User Story 1

- [ ] T033 [P] [US1] Plugins de conexión a Mongo (Mongoose) y Redis (ioredis) con `ping` y cierre ordenado en `apps/api/src/plugins/mongo.ts` y `apps/api/src/plugins/redis.ts` — `feat(api)`
- [ ] T034 [US1] Rutas `/health`, `/health/deep` (check `analytics` con el cliente interno, timeout de 2 s), `/version` y `/config` (flags de T016) en `apps/api/src/routes/health.ts`; `server.ts` escucha en `HOST` (`::`) — `feat(api)`
- [ ] T035 [P] [US1] Rutas `/health` y `/version` de analytics (ping a Mongo con motor y a Redis) en `apps/analytics/src/analytics/routes/health.py` — `feat(analytics)`
- [ ] T036 [P] [US1] Página inicial de `web` que muestra "ReqCanvas", la versión y un canvas three.js mínimo de prueba en `apps/web/src/App.tsx`; carga la configuración de `/config.js` en `apps/web/src/lib/config.ts` — `feat(web)`
- [ ] T037 [P] [US1] `Dockerfile` multi-stage de `api` (pnpm deploy, usuario no root; incluye `migrate-mongo` para el *pre-deploy*) en `apps/api/Dockerfile` — `build(api)`
- [ ] T038 [P] [US1] `Dockerfile` multi-stage de `analytics` (uv, usuario no root) en `apps/analytics/Dockerfile` — `build(analytics)`
- [ ] T039 [P] [US1] `Dockerfile` de `web` (build de Vite + Caddy), `Caddyfile` con fallback de SPA y `/health`, y `docker-entrypoint.sh` que valida `API_PUBLIC_URL` (termina con código 1 si falta, FR-005) y genera `/config.js`, en `apps/web/` — `build(web)`
- [ ] T040 [US1] `infra/docker-compose.yml` con `mongodb`, `redis`, `api`, `analytics` y `web` (healthchecks, `depends_on: condition: service_healthy`, migraciones al arrancar `api`) y `.env.example` — `build(infra)`
- [ ] T041 [US1] README con prerrequisitos, `pnpm dev:up` y la verificación de salud (quickstart §1–4) en `README.md` — `docs(repo)`

**Checkpoint**: US1 funcional y demostrable de forma local

---

## Phase 4: User Story 2 - Validación automática de cada cambio (Priority: P1)

**Goal**: cada PR se valida automáticamente y no se integra con el pipeline en rojo

**Independent Test**: PR con un error de lint → rojo; corregido → verde (quickstart §7.1–7.2)

### Tests for User Story 2 ⚠️

- [ ] T042 [P] [US2] Prueba de que la configuración de commitlint rechaza `"cambios varios"` y acepta `"feat(api): add health"` en `tests/repo/commitlint.test.ts` — `test(repo)`
- [ ] T043 [P] [US2] Configurar el umbral de cobertura del 70 % en `apps/api/vitest.config.ts` y en `apps/analytics/pyproject.toml` (`--cov-fail-under=70`) — `test(ci)`

### Implementation for User Story 2

- [ ] T044 [US2] Workflow `.github/workflows/ci.yml` con los jobs `lint`, `typecheck`, `commitlint`, `secrets`, `test-node`, `test-python`, `migrations` (up/down/up + política), `build` (con verificación de tamaño de imagen: `api` < 300 MB, `analytics` < 1,2 GB) y `e2e-smoke` según `contracts/ci-cd-pipeline.md` (con caché de pnpm, uv y buildx) — `ci`
- [ ] T045 [P] [US2] Configuración de gitleaks en `.gitleaks.toml` — `ci`
- [ ] T046 [P] [US2] Plantilla de PR con checklist de constitución (commits atómicos, pruebas, sin secretos, migraciones destructivas declaradas) en `.github/pull_request_template.md` — `docs(repo)`
- [ ] T047 [US2] Documentar en `docs/runbooks/branch-protection.md` y aplicar con `gh api` la protección de `main`: checks obligatorios de T044, 1 revisión, **historial lineal obligatorio**, y en el repositorio solo **"Rebase and merge"** habilitado (merge commits y squash deshabilitados) — `docs(ci)`

**Checkpoint**: US1 y US2 funcionan de forma independiente

---

## Phase 5: User Story 3 - Despliegue continuo a staging y producción (Priority: P2)

**Goal**: `main` → staging automático con smoke tests; tag → producción con aprobación

**Independent Test**: quickstart §7.3–7.4

### Tests for User Story 3 ⚠️

- [ ] T048 [US3] Script `scripts/wait-for-health.sh` (reintenta una URL hasta `200` o timeout) con su prueba de shell en `tests/repo/wait-for-health.test.sh` — `test(ci)`

### Implementation for User Story 3

- [ ] T049 [P] [US3] `apps/api/railway.json` (builder DOCKERFILE, `dockerfilePath`, `watchPatterns` = `apps/api/**` y `packages/shared/**`, `healthcheckPath: /health`, **`preDeployCommand: pnpm migrate:up`**, `restartPolicyType: ON_FAILURE`, `restartPolicyMaxRetries: 3`) — `build(api)`
- [ ] T050 [P] [US3] `apps/analytics/railway.json` con la misma estructura, sin `preDeployCommand` — `build(analytics)`
- [ ] T051 [P] [US3] `apps/web/railway.json` con la misma estructura, sin `preDeployCommand` — `build(web)`
- [ ] T052 [US3] Crear en Railway el proyecto, los entornos `staging` y `production`, los servicios `api`, `analytics` y `web` (desde el repo, autodeploy desactivado; dominio público solo en `web` y `api`) y `MongoDB` y `Redis` (plantillas, **sin proxy TCP público**); definir las variables de referencia de `contracts/env-vars.md`; documentarlo en `docs/adr/0002-despliegue-railway.md` — `docs(infra)`
- [ ] T053 [US3] Crear con `gh api` los GitHub Environments `staging` y `production`: secret `RAILWAY_TOKEN` (project token del entorno) en cada uno; variables `STAGING_BASE_URL`/`STAGING_API_URL` y `PRODUCTION_BASE_URL`/`PRODUCTION_API_URL`; en `production`, revisores obligatorios y despliegue solo desde tags `v*` y `main`; documentarlo en `docs/runbooks/github-environments.md` — `docs(ci)`
- [ ] T054 [US3] Workflow `.github/workflows/deploy.yml`: staging tras `ci` en `main`; producción con tag o `workflow_dispatch` usando el Environment `production` (aprobación manual); `concurrency` por entorno; job `backup` (`mongodump` vía `railway ssh`) solo si hay migraciones nuevas con `destructive: true`; `railway up --ci` ×3 (las migraciones las aplica el `preDeployCommand` de `api`) → `wait-for-health` sobre `web /health` y `api /health/deep` → smoke de Playwright; si el smoke falla, el job falla y GitHub notifica al autor del push — `ci`
- [ ] T055 [US3] Workflow `.github/workflows/release.yml` con release-please (`release-please-config.json`, `.release-please-manifest.json`) — `ci`
- [ ] T056 [US3] Inyectar `APP_VERSION` y `GIT_SHA` en las imágenes (build args) y verificarlos con `/version` en el smoke test — `feat(ci)`

**Checkpoint**: una versión integrada llega a staging y se puede promover a producción

---

## Phase 6: User Story 4 - Reversión segura (Priority: P3)

**Goal**: volver a la versión anterior en < 10 min, datos incluidos

**Independent Test**: quickstart §5 y §8

### Tests for User Story 4 ⚠️

- [ ] T057 [US4] Prueba del script de rollback `scripts/rollback.sh` (valida `ref` y `environment`, rechaza refs inexistentes y construye la invocación de `deploy.yml` y de `migrate-down`) en `tests/repo/rollback.test.sh` — `test(ops)`

### Implementation for User Story 4

- [ ] T058 [US4] Implementar `scripts/rollback.sh` (dispara `deploy.yml` con el `ref` anterior mediante `gh workflow run` y, opcionalmente, `migrate-down`) — `feat(ops)`
- [ ] T059 [US4] Acción `migrate-down` en `.github/workflows/deploy.yml` (`railway ssh --service api --environment <env> -- pnpm migrate:down`, con aprobación en `production`) y restauración del respaldo (`mongorestore`) para migraciones destructivas — `ci`
- [ ] T060 [US4] Runbook de rollback en `docs/runbooks/rollback.md`: redespliegue por tag (`scripts/rollback.sh`), Rollback en el panel de Railway, `migrate-down`, restauración del respaldo si la migración era destructiva, alternativa desde la consola de Railway si `railway ssh` no está disponible, y verificación con `/version` — `docs(ops)`
- [ ] T061 [US4] Ensayo de rollback en staging: desplegar v0.1.0 y v0.1.1 (con una migración de prueba), volver a v0.1.0 y revertir la migración midiendo el tiempo; registrar el resultado en `docs/runbooks/rollback.md` (SC-004) — `docs(ops)`

**Checkpoint**: las cuatro historias funcionan de forma independiente

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T062 [P] ADR del monorepo y el stack en `docs/adr/0001-monorepo-y-stack.md` (decisiones R1–R3 y R13 de research.md) — `docs(adr)`
- [ ] T063 Medir los tiempos de CI (< 15 min) y de despliegue a staging (< 20 min) y la latencia de `/health` en staging (p95 < 200 ms con 50 peticiones, añadido como aserción al smoke de T032); optimizar las cachés si hace falta (SC-002, SC-003) — `ci`
- [ ] T064 Ejecutar quickstart.md completo en una máquina limpia y corregir el README donde falle (SC-001) — `docs(repo)`
- [ ] T065 Actualizar la referencia al plan en `CLAUDE.md` si cambian comandos o estructura — `docs(repo)`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → historias.
- **US1 (P1)**: tras la Phase 2. Es la base de US2 (el job `e2e-smoke` usa el Compose y el smoke de US1).
- **US2 (P1)**: tras US1 (T032, T037–T040).
- **US3 (P2)**: tras US2 (el deploy se encadena a `ci.yml`). T049 depende de T027 (migrate-mongo, ya en la Phase 2). T054 depende de T052 y T053.
- **US4 (P3)**: tras US3 (usa `deploy.yml` y los Environments).
- **Polish**: al final.

### Within Each User Story

- Pruebas (en rojo) → implementación (en verde) → refactor; un commit por tarea.

### Parallel Opportunities

- Phase 1: T002–T005 y T007–T010 en paralelo.
- Phase 2: los pares prueba/implementación de `shared` (T012–T016), `api` (T017–T018, T021–T022, T026–T027) y `analytics` (T019–T020, T023–T024) en paralelo entre sí.
- US1: T028–T032 en paralelo; luego T033, T035, T036 y T037–T039 en paralelo.
- US3: T049–T051 en paralelo; T052 y T053 en paralelo.

## Parallel Example: User Story 1

```bash
# Pruebas en paralelo (deben fallar):
Task: "Contract test de /health y /health/deep de la API en apps/api/tests/contract/health.contract.test.ts"
Task: "Contract test de /health de analytics en apps/analytics/tests/contract/test_health.py"
Task: "Test de App en apps/web/tests/App.test.tsx"

# Implementación en paralelo:
Task: "Dockerfile de api en apps/api/Dockerfile"
Task: "Dockerfile de analytics en apps/analytics/Dockerfile"
Task: "Dockerfile + Caddyfile de web en apps/web/"
```

## Implementation Strategy

### MVP First

1. Phases 1 y 2 → 2. US1 (entorno local) → **validar con quickstart §1–4** → 3. US2 (CI).
Con US1 + US2, el equipo ya puede empezar la feature 002 con garantías de calidad.

### Incremental Delivery

US3 (staging/producción) se puede terminar en paralelo al inicio de la feature 002; US4 se
cierra antes del primer despliegue a producción con datos reales.

## Notes

- Tareas totales: 65 (Setup 11, Foundational 16, US1 14, US2 6, US3 9, US4 5, Polish 4).
- Cambios tras `/speckit-analyze`: C1 → T053; I3 → migraciones en la Phase 2 (T026–T027);
  I4 → flags de la API en la Phase 2 (T016); X1 → T023/T024 separadas; I1/U1 → T021, T029,
  T032, T034, T054; S1 → T049, T052, T054, T059; I2 → T047; A1 → T026, T027, T060.
- Nunca integrar un commit que rompa `pnpm test` (Principio IV).
- T047, T052 y T053 requieren acceso a Railway y GitHub con permisos de administración.
