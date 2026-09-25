---
description: "Task list for feature 001-plataforma-base"
---

# Tasks: Plataforma base y entrega continua

**Input**: Design documents from `/specs/001-plataforma-base/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: OBLIGATORIAS (Principio III de la constitución). Las pruebas de cada historia se
escriben primero y deben fallar antes de implementar.

**Commits**: cada tarea (o cada par prueba + implementación) es **un commit atómico** con
formato Conventional Commits; el alcance sugerido va al final de cada tarea, p. ej. `(api)`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia de usuario de spec.md (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: esqueleto del monorepo y herramientas de calidad

- [ ] T001 Crear `package.json` raíz (private, `packageManager: pnpm@10`, `engines.node >=24`) y `pnpm-workspace.yaml` con `apps/web`, `apps/api`, `packages/shared` — `chore(repo)`
- [ ] T002 [P] Añadir `.gitignore`, `.editorconfig`, `.nvmrc` (24) y `.python-version` (3.12) en la raíz — `chore(repo)`
- [ ] T003 [P] Configurar TypeScript base en `tsconfig.base.json` (strict, ES2023, `moduleResolution: bundler`) — `chore(repo)`
- [ ] T004 [P] Configurar ESLint (flat config) en `eslint.config.js` y Prettier en `.prettierrc` + `.prettierignore` — `chore(lint)`
- [ ] T005 [P] Configurar commitlint (`@commitlint/config-conventional`, scopes: repo, web, api, analytics, shared, infra, ci, docs, specs, speckit) en `commitlint.config.cjs` — `chore(repo)`
- [ ] T006 Instalar Husky + lint-staged: hooks `commit-msg` (commitlint) y `pre-commit` (lint-staged) en `.husky/` — `chore(repo)`
- [ ] T007 [P] Crear `packages/shared` (`package.json`, `tsconfig.json`, `src/index.ts`, Vitest) — `chore(shared)`
- [ ] T008 [P] Crear `apps/api` con Fastify 5, TypeScript y Vitest (`package.json`, `tsconfig.json`, `vitest.config.ts`, `src/app.ts`, `src/server.ts`) — `chore(api)`
- [ ] T009 [P] Crear `apps/web` con Vite + React + TypeScript + `three`, `@react-three/fiber` y Vitest (`apps/web/package.json`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`) — `chore(web)`
- [ ] T010 [P] Crear `apps/analytics` con uv: `pyproject.toml` (fastapi, uvicorn, pydantic-settings, motor, redis, python-json-logger; dev: pytest, pytest-cov, httpx, ruff, mypy) y `src/analytics/main.py` — `chore(analytics)`
- [ ] T011 Añadir scripts raíz en `package.json`: `lint`, `format:check`, `typecheck`, `test`, `test:py`, `dev:up`, `dev:down` — `chore(repo)`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contratos compartidos, configuración y logging que usan todas las historias

**⚠️ CRITICAL**: ninguna historia puede empezar hasta completar esta fase

- [ ] T012 [P] Prueba unitaria del esquema de salud en `packages/shared/tests/health.test.ts` (valida los ejemplos de `contracts/health.openapi.yaml`) — `test(shared)`
- [ ] T013 Implementar el esquema zod `HealthSchema` y los tipos en `packages/shared/src/health.ts` — `feat(shared)`
- [ ] T014 [P] Prueba unitaria de la resolución de flags (default, sobrescritura, nombre desconocido → aviso) en `packages/shared/tests/flags.test.ts` — `test(shared)`
- [ ] T015 Implementar el registro de flags y `resolveFlags(env)` en `packages/shared/src/flags.ts` — `feat(shared)`
- [ ] T016 [P] Prueba unitaria de la validación de entorno de la API (falta `MONGO_URL` → error que nombra la variable sin su valor) en `apps/api/tests/unit/env.test.ts` — `test(api)`
- [ ] T017 Implementar `apps/api/src/config/env.ts` con zod según `contracts/env-vars.md` — `feat(api)`
- [ ] T018 [P] Prueba unitaria de la configuración de analytics en `apps/analytics/tests/unit/test_config.py` — `test(analytics)`
- [ ] T019 Implementar `apps/analytics/src/analytics/config.py` con pydantic-settings — `feat(analytics)`
- [ ] T020 [P] Prueba de integración: la API reutiliza o genera `x-request-id`, lo devuelve y lo incluye en el log, en `apps/api/tests/integration/request-id.test.ts` — `test(api)`
- [ ] T021 Implementar el plugin de requestId + logger pino (redacción de secretos) en `apps/api/src/plugins/observability.ts` — `feat(api)`
- [ ] T022 [P] Prueba y middleware de `request_id` + logs JSON en `apps/analytics/tests/unit/test_logging.py` y `apps/analytics/src/analytics/logging.py` — `feat(analytics)`
- [ ] T023 Registrar `@fastify/helmet` y `@fastify/cors` (desde `CORS_ORIGINS`) en `apps/api/src/app.ts` — `feat(api)`

**Checkpoint**: fundaciones listas

---

## Phase 3: User Story 1 - Entorno local reproducible (Priority: P1) 🎯 MVP

**Goal**: `pnpm dev:up` levanta los 5 servicios y todos responden "saludable"

**Independent Test**: quickstart.md, pasos 1 a 4

### Tests for User Story 1 ⚠️

- [ ] T024 [P] [US1] Prueba de contrato de `GET /health`, `GET /version` y `GET /config` de la API contra `contracts/health.openapi.yaml` en `apps/api/tests/contract/health.contract.test.ts` — `test(api)`
- [ ] T025 [P] [US1] Prueba de integración de `/health`: `200 ok` con Mongo y Redis arriba; `503 degraded` con Mongo caído, en `apps/api/tests/integration/health.test.ts` — `test(api)`
- [ ] T026 [P] [US1] Pruebas de contrato e integración de `/health` y `/version` de analytics en `apps/analytics/tests/contract/test_health.py` — `test(analytics)`
- [ ] T027 [P] [US1] Prueba del componente `App` (muestra "ReqCanvas" y la versión) en `apps/web/tests/App.test.tsx` — `test(web)`
- [ ] T028 [P] [US1] Smoke de Playwright (página inicial + los 3 `/health`), parametrizado por `BASE_URL` y `API_URL`, en `e2e/smoke.spec.ts` y `e2e/playwright.config.ts` — `test(e2e)`

### Implementation for User Story 1

- [ ] T029 [P] [US1] Plugins de conexión a Mongo (Mongoose) y Redis (ioredis) con `ping` y cierre ordenado en `apps/api/src/plugins/mongo.ts` y `apps/api/src/plugins/redis.ts` — `feat(api)`
- [ ] T030 [US1] Rutas `/health`, `/version` y `/config` (flags activos) en `apps/api/src/routes/health.ts`; `server.ts` escucha en `HOST` (`::`) — `feat(api)`
- [ ] T031 [P] [US1] Rutas `/health` y `/version` de analytics (ping a Mongo con motor y a Redis) en `apps/analytics/src/analytics/routes/health.py` — `feat(analytics)`
- [ ] T032 [P] [US1] Página inicial de `web` que muestra "ReqCanvas", la versión y un canvas three.js mínimo de prueba en `apps/web/src/App.tsx`; carga la configuración de `/config.js` en `apps/web/src/lib/config.ts` — `feat(web)`
- [ ] T033 [P] [US1] `Dockerfile` multi-stage de `api` (pnpm deploy, usuario no root) en `apps/api/Dockerfile` — `build(api)`
- [ ] T034 [P] [US1] `Dockerfile` multi-stage de `analytics` (uv, usuario no root) en `apps/analytics/Dockerfile` — `build(analytics)`
- [ ] T035 [P] [US1] `Dockerfile` de `web` (build de Vite + Caddy), `Caddyfile` con fallback de SPA y `/health`, y `docker-entrypoint.sh` que genera `/config.js` desde `API_PUBLIC_URL`, en `apps/web/` — `build(web)`
- [ ] T036 [US1] `infra/docker-compose.yml` con `mongodb`, `redis`, `api`, `analytics` y `web` (healthchecks y `depends_on: condition: service_healthy`) y `.env.example` — `build(infra)`
- [ ] T037 [US1] README con prerrequisitos, `pnpm dev:up` y la verificación de salud (quickstart §1–4) en `README.md` — `docs(repo)`

**Checkpoint**: US1 funcional y demostrable de forma local

---

## Phase 4: User Story 2 - Validación automática de cada cambio (Priority: P1)

**Goal**: cada PR se valida automáticamente y no se integra con el pipeline en rojo

**Independent Test**: PR con un error de lint → rojo; corregido → verde (quickstart §7.1–7.2)

### Tests for User Story 2 ⚠️

- [ ] T038 [P] [US2] Prueba de que la configuración de commitlint rechaza `"cambios varios"` y acepta `"feat(api): add health"` en `tests/repo/commitlint.test.ts` — `test(repo)`
- [ ] T039 [P] [US2] Configurar el umbral de cobertura del 70 % en `apps/api/vitest.config.ts` y en `apps/analytics/pyproject.toml` (`--cov-fail-under=70`) — `test(ci)`

### Implementation for User Story 2

- [ ] T040 [US2] Workflow `.github/workflows/ci.yml` con los jobs `lint`, `typecheck`, `commitlint`, `secrets`, `test-node`, `test-python`, `build` y `e2e-smoke` según `contracts/ci-cd-pipeline.md` (con caché de pnpm, uv y buildx) — `ci`
- [ ] T041 [P] [US2] Configuración de gitleaks en `.gitleaks.toml` — `ci`
- [ ] T042 [P] [US2] Plantilla de PR con checklist de constitución (commits atómicos, pruebas, sin secretos) en `.github/pull_request_template.md` — `docs(repo)`
- [ ] T043 [US2] Documentar en `docs/runbooks/branch-protection.md` la protección de `main` (checks obligatorios, 1 revisión, sin squash) y aplicarla con `gh api` — `docs(ci)`

**Checkpoint**: US1 y US2 funcionan de forma independiente

---

## Phase 5: User Story 3 - Despliegue continuo a staging y producción (Priority: P2)

**Goal**: `main` → staging automático con smoke tests; tag → producción con aprobación

**Independent Test**: quickstart §7.3–7.4

### Tests for User Story 3 ⚠️

- [ ] T044 [US3] Script `scripts/wait-for-health.sh` (reintenta `/health` hasta 200 o timeout) con su prueba bats o de shell en `tests/repo/wait-for-health.test.sh` — `test(ci)`

### Implementation for User Story 3

- [ ] T045 [P] [US3] `apps/api/railway.json` (builder DOCKERFILE, `dockerfilePath`, `watchPatterns` = `apps/api/**` y `packages/shared/**`, `healthcheckPath: /health`, `restartPolicyType: ON_FAILURE`, `restartPolicyMaxRetries: 3`) — `build(api)`
- [ ] T046 [P] [US3] `apps/analytics/railway.json` con la misma estructura — `build(analytics)`
- [ ] T047 [P] [US3] `apps/web/railway.json` con la misma estructura — `build(web)`
- [ ] T048 [US3] Crear en Railway el proyecto, los entornos `staging` y `production`, los servicios `api`, `analytics` y `web` (desde el repo, autodeploy desactivado) y `MongoDB` y `Redis` (plantillas); definir las variables de referencia de `contracts/env-vars.md`; documentarlo en `docs/adr/0002-despliegue-railway.md` — `docs(infra)`
- [ ] T049 [US3] Workflow `.github/workflows/deploy.yml`: staging tras `ci` en `main`; producción con tag o `workflow_dispatch`, con GitHub Environment `production` protegido; `concurrency` por entorno; pasos de migración → `railway up --ci` ×3 → `wait-for-health` → smoke de Playwright — `ci`
- [ ] T050 [US3] Workflow `.github/workflows/release.yml` con release-please (`release-please-config.json`, `.release-please-manifest.json`) — `ci`
- [ ] T051 [US3] Inyectar `APP_VERSION` y `GIT_SHA` en las imágenes (build args) y verificarlos con `/version` en el smoke test — `feat(ci)`

**Checkpoint**: una versión integrada llega a staging y se puede promover a producción

---

## Phase 6: User Story 4 - Reversión segura (Priority: P3)

**Goal**: volver a la versión anterior en < 10 min, datos incluidos

**Independent Test**: quickstart §5 y §8

### Tests for User Story 4 ⚠️

- [ ] T052 [P] [US4] Prueba de migración `up → down → up` de la migración inicial en `apps/api/tests/integration/migrations.test.ts` — `test(api)`

### Implementation for User Story 4

- [ ] T053 [US4] Configurar migrate-mongo (`apps/api/migrate-mongo-config.cjs`, scripts `migrate:up|down|status`) y crear la migración `apps/api/migrations/20260925000000-init-indexes.js` según data-model.md — `feat(api)`
- [ ] T054 [US4] Job `migrations` (up/down/up) en `.github/workflows/ci.yml` y acción `migrate-down` en `.github/workflows/deploy.yml` — `ci`
- [ ] T055 [US4] Runbook de rollback (redespliegue por tag, Rollback en el panel de Railway, `migrate-down`, verificación con `/version`) en `docs/runbooks/rollback.md` — `docs(ops)`
- [ ] T056 [US4] Ensayo de rollback en staging: desplegar v0.1.0 y v0.1.1, volver a v0.1.0 y medir el tiempo; registrar el resultado en `docs/runbooks/rollback.md` — `docs(ops)`

**Checkpoint**: las cuatro historias funcionan de forma independiente

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T057 [P] ADR del monorepo y el stack en `docs/adr/0001-monorepo-y-stack.md` (decisiones R1–R3 y R13 de research.md) — `docs(adr)`
- [ ] T058 [P] Añadir `apps/api/src/lib/flags.ts` (lee `FEATURE_FLAGS` con `resolveFlags`) y documentar cómo crear un flag en `docs/feature-flags.md` — `feat(api)`
- [ ] T059 Medir los tiempos de CI (< 15 min) y de despliegue a staging (< 20 min) y optimizar las cachés si hace falta — `ci`
- [ ] T060 Ejecutar quickstart.md completo en una máquina limpia y corregir el README donde falle (SC-001) — `docs(repo)`
- [ ] T061 Actualizar la referencia al plan en `CLAUDE.md` si cambian comandos o estructura — `docs(repo)`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → historias.
- **US1 (P1)**: tras la Phase 2. Es la base de US2 (el job `e2e-smoke` usa el Compose y el smoke de US1).
- **US2 (P1)**: tras US1 (T028, T033–T036).
- **US3 (P2)**: tras US2 (el deploy se encadena a `ci.yml`).
- **US4 (P3)**: T052–T053 pueden hacerse tras la Phase 2; T054–T056 requieren US2 y US3.
- **Polish**: al final.

### Within Each User Story

- Pruebas (en rojo) → implementación (en verde) → refactor; un commit por paso lógico.

### Parallel Opportunities

- Phase 1: T002–T005 y T007–T010 en paralelo.
- Phase 2: los pares prueba/implementación de `shared`, `api` y `analytics` en paralelo entre sí.
- US1: T024–T028 en paralelo; luego T029, T031, T032 y T033–T035 en paralelo.
- US3: T045–T047 en paralelo.

## Parallel Example: User Story 1

```bash
# Pruebas en paralelo (deben fallar):
Task: "Contract test de /health de la API en apps/api/tests/contract/health.contract.test.ts"
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

- Tareas totales: 61 (Setup 11, Foundational 12, US1 14, US2 6, US3 8, US4 5, Polish 5).
- Nunca integrar un commit que rompa `pnpm test` (Principio IV).
- T048 y T043 requieren acceso a Railway y GitHub con permisos de administración.
