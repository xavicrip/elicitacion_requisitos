# Research: Plataforma base y entrega continua

**Feature**: 001-plataforma-base | **Date**: 2026-09-25

No quedaron `NEEDS CLARIFICATION` en el Technical Context. Estas son las decisiones tomadas.

## R1. Gestión del monorepo

- **Decision**: pnpm workspaces (`apps/web`, `apps/api`, `packages/shared`) con scripts
  recursivos (`pnpm -r`). `apps/analytics` se gestiona con **uv** y se invoca desde los scripts
  raíz.
- **Rationale**: es lo que pide prompt.md; para 3 apps no hace falta un orquestador con caché
  distribuida.
- **Alternatives considered**: Turborepo o Nx (añaden configuración sin beneficio a esta
  escala; se pueden incorporar con un ADR si el CI supera los 15 min); npm workspaces (peor
  manejo de dependencias fantasma).

## R2. Versión de Node.js

- **Decision**: Node.js **24 LTS** (fijado en la constitución v1.1.0). Se declara en `.nvmrc`,
  en `engines.node` (`>=24 <25`), en las imágenes base `node:24-alpine` y en
  `actions/setup-node` (`node-version-file: .nvmrc`).
- **Rationale**: es la LTS activa en 2026-09; Node 22 está en mantenimiento. Empezar en la LTS
  activa evita una migración a mitad del proyecto.
- **Alternatives considered**: Node 22 (valor original de prompt.md, ya actualizado).

## R3. Framework de la API

- **Decision**: **Fastify 5** con `fastify.inject` para pruebas, `@fastify/helmet`,
  `@fastify/cors`, `@fastify/rate-limit`, y Socket.IO montado sobre el mismo servidor HTTP.
- **Rationale**: validación por esquemas integrada, logger pino nativo con `genReqId`
  (necesario para `requestId`) y mejor rendimiento que Express.
- **Alternatives considered**: Express (sin esquemas nativos y con logging manual); NestJS
  (demasiada ceremonia para el tamaño del equipo).

## R4. Healthchecks

- **Decision**: dos niveles en `api`:
  - `GET /health` (**el que usa Railway** como healthcheck de despliegue): `200` con
    `{status:"ok", checks:{mongo,redis}}` si sus dependencias directas responden; `503` con
    `status:"degraded"` y la dependencia que falla en caso contrario.
  - `GET /health/deep` (el que usan los smoke tests): igual que `/health` más el check
    `analytics`, que llama a `GET http://analytics.railway.internal:<port>/health` por la red
    privada con un timeout de 2 s, **reenviando `x-request-id`**.
  `analytics` expone su propio `/health` (Mongo y Redis), que solo es accesible por la red
  privada. `GET /version` devuelve la versión y el commit (`GIT_SHA`). `web` sirve un
  `/health` estático desde Caddy.
- **Rationale**: `analytics` no tiene dominio público, así que un smoke test externo no
  puede consultarlo directamente; el check profundo lo verifica a través de `api` y, a la vez,
  demuestra la propagación del `requestId` entre servicios (FR-004). `analytics` no forma
  parte del healthcheck de despliegue de `api`, para que una caída de `analytics` no bloquee
  los despliegues de `api`.
- **Alternatives considered**: dar un dominio público a `analytics` (aumenta la superficie de
  ataque); liveness y readiness separados al estilo de Kubernetes (Railway usa un solo
  healthcheck de despliegue).

## R5. Logs y correlación

- **Decision**: pino (`api`) y python-json-logger (`analytics`), en JSON a stdout. Cabecera
  `x-request-id`: se reutiliza si llega, o se genera un UUID v7; se propaga en las llamadas
  entre servicios y se incluye en cada línea de log.
  `api` usa un cliente HTTP interno (`apps/api/src/lib/http-client.ts`, basado en `fetch`)
  que añade automáticamente el `x-request-id` de la petición en curso a toda llamada saliente;
  el primer uso es el check `analytics` de `/health/deep`.
- **Rationale**: Railway indexa los logs JSON y permite filtrar por atributos; el cliente
  interno garantiza la propagación sin depender de que cada llamada la recuerde.
- **Alternatives considered**: OpenTelemetry completo (se deja para más adelante; el
  `requestId` cubre RNF-07).

## R6. Validación de configuración

- **Decision**: esquema zod en `apps/api/src/config/env.ts` y `pydantic-settings` en
  `analytics`. Si falta una variable obligatoria, el proceso termina con código 1 y registra
  el **nombre** de la variable (nunca su valor).
- **Rationale**: cumple FR-005 y el edge case "falta una variable".

## R7. Migraciones reversibles

- **Decision**: **migrate-mongo** (colección `changelog`), con migraciones en
  `apps/api/migrations`. Cada migración implementa `up` y `down`, y CI ejecuta
  `up → down → up` contra una MongoDB efímera.
- **Rationale**: cumple el principio IV y FR-010; probar el `down` en CI garantiza que es
  reversible de verdad.
- **Alternatives considered**: migraciones con Mongoose (sin `down` estándar).

## R8. Feature flags

- **Decision**: flags declarados en `packages/shared/src/flags.ts` (nombre, descripción,
  valor por defecto) y activados por entorno con la variable `FEATURE_FLAGS`
  (p. ej., `detection=true,insights=false`). La API expone los flags activos a `web` en
  `GET /config`.
- **Rationale**: es lo más simple que cumple FR-011 (Principio VII).
- **Alternatives considered**: Unleash o GrowthBook (otro servicio que operar), flags en
  MongoDB (innecesario por ahora).

## R9. Estrategia de despliegue en Railway

- **Decision**:
  - Un proyecto de Railway con dos entornos (`staging`, `production`) y cinco servicios:
    `web`, `api`, `analytics` (desde el repositorio, builder `DOCKERFILE`) y `mongodb`,
    `redis` (plantillas de base de datos de Railway).
  - Configuración como código en `apps/*/railway.json`: `build.dockerfilePath`,
    `build.watchPatterns`, `deploy.healthcheckPath`, `deploy.healthcheckTimeout`,
    `deploy.restartPolicyType: ON_FAILURE`, `deploy.restartPolicyMaxRetries: 3`.
  - Los despliegues los dispara **exclusivamente GitHub Actions** (constitución v1.1.0) con `railway up --ci --service <svc>
    --environment <env>`, usando un **project token** por entorno (`RAILWAY_TOKEN`, guardado
    en el GitHub Environment correspondiente). El autodeploy de Railway queda desactivado para
    que solo se despliegue lo que pasó CI.
  - Comunicación interna por la red privada (`api.railway.internal`,
    `analytics.railway.internal`); los servicios escuchan en `::` (IPv6). Solo `web` y `api`
    tienen dominio público.
  - Referencias entre variables de Railway: `MONGO_URL=${{MongoDB.MONGO_URL}}`,
    `REDIS_URL=${{Redis.REDIS_URL}}`.
- **Rationale**: GitHub Environments aportan la aprobación manual (required reviewers) que
  exige FR-009, y el despliegue desde CI garantiza que nada llega a staging sin pasar las
  gates.
- **Alternatives considered**: autodeploy de Railway desde GitHub con "Wait for CI" (más
  simple, pero sin aprobación manual para producción); entornos efímeros por PR de Railway
  (se activan si el plan de la cuenta lo permite; no bloquean la feature, según la spec).

## R10. Rollback

- **Decision**: el workflow `deploy.yml` admite `workflow_dispatch` con un `ref` (tag o SHA),
  así que un rollback consiste en redesplegar el tag anterior (< 10 min). Como alternativa
  inmediata, se usa "Rollback" en el panel de Railway. Si la versión incluía una migración, se
  ejecuta `migrate-mongo down` con el job `migrate-down` del mismo workflow. Todo se documenta
  en `docs/runbooks/rollback.md`.
- **Rationale**: es reproducible y queda auditado en GitHub (SC-004).

## R11. Gates de calidad en CI

- **Decision**: `ci.yml` con los jobs `lint` (ESLint, Prettier, Ruff), `typecheck` (tsc, mypy),
  `test-node` y `test-python` (con servicios `mongo:7` y `redis:7`, y umbral de cobertura del
  70 %), `migrations` (up/down/up), `build` (docker buildx con caché de GHA),
  `commitlint` (wagoid/commitlint-github-action), `secrets` (gitleaks) y `e2e-smoke`
  (Docker Compose + Playwright). Protección de rama en `main`: todos los jobs obligatorios, al
  menos 1 revisión, merge commit o rebase (sin squash).
- **Rationale**: cumple FR-006 y FR-007 y el principio IV.

## R12. Releases

- **Decision**: **release-please** en `release.yml` genera `CHANGELOG.md` y tags `vX.Y.Z` a
  partir de Conventional Commits. El despliegue a producción se hace sobre el tag.
- **Alternatives considered**: semantic-release (publica automáticamente; release-please
  permite revisar la release en un PR).

## R13. Servir el frontend

- **Decision**: build estático de Vite servido por **Caddy** (imagen oficial), con fallback
  de SPA a `index.html`, compresión y cabeceras de seguridad. La URL de la API se inyecta
  en tiempo de ejecución mediante `/config.js`, generado al arrancar el contenedor, para no
  reconstruir la imagen por entorno.
- **Rationale**: la misma imagen sirve para staging y producción (build once, deploy many).
- **Alternatives considered**: Nginx (equivalente, con configuración más verbosa); servir el
  frontend desde la API (acopla los despliegues).
