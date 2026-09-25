# Implementation Plan: Plataforma base y entrega continua

**Branch**: `001-plataforma-base` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-plataforma-base/spec.md`

## Summary

Crear el esqueleto del monorepo ReqCanvas con tres servicios mínimos pero desplegables
(`web`, `api`, `analytics`) y un paquete de contratos compartidos (`packages/shared`). Cada
servicio expone un healthcheck real, logs JSON con `requestId` y validación de configuración
al arrancar. Se incluyen un entorno local con Docker Compose (MongoDB + Redis), migraciones
reversibles (migrate-mongo), feature flags por entorno y un pipeline de GitHub Actions que
valida cada PR, despliega `main` en Railway **staging**, ejecuta smoke tests y promueve a
**production** con aprobación manual. El rollback se hace redesplegando un tag anterior o
revirtiendo el commit.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 24 LTS (`web`, `api`, `shared`); Python 3.12 (`analytics`)
**Primary Dependencies**: pnpm workspaces; Vite + React + three.js (`@react-three/fiber`) en `web`; Fastify 5 + Socket.IO (instalado, sin uso aún) + Mongoose + zod + pino en `api`; FastAPI + pydantic-settings + motor + redis-py en `analytics`; migrate-mongo
**Storage**: MongoDB 7 (Railway MongoDB) y Redis 7 (Railway Redis); sin almacenamiento de objetos en esta feature
**Testing**: Vitest (+ `fastify.inject`) en `api`/`shared`/`web`; pytest + httpx en `analytics`; Playwright para smoke/E2E
**Target Platform**: Contenedores Linux en Railway; navegadores de escritorio actuales (Chrome, Edge, Firefox, Safari)
**Project Type**: Aplicación web (monorepo con frontend, API y servicio analítico)
**Performance Goals**: Pipeline de PR < 15 min; despliegue en staging < 20 min; healthcheck < 200 ms
**Constraints**: Servicios stateless; secretos solo en variables de entorno; imágenes Docker multi-stage < 300 MB (`api`), < 1,2 GB (`analytics`)
**Scale/Scope**: 5 servicios en Railway (`web`, `api`, `analytics`, `mongodb`, `redis`) × 2 entornos (staging, production) + entorno local

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo cumple este plan | Estado |
|-----------|--------------------------|--------|
| I. Requisito anclado a la actividad | No aplica (sin dominio de requisitos en esta feature). | ✅ N/A |
| II. Servicios desacoplados con contratos | Tres servicios independientes, `packages/shared` con esquemas zod; contrato de salud común en `contracts/health.openapi.yaml`; los servicios no comparten colecciones. | ✅ |
| III. Pruebas primero | Cada historia empieza con pruebas que fallan (healthcheck, validación de config, logs); gates de cobertura ≥ 70 % en CI para `api` y `analytics`. | ✅ |
| IV. Commits atómicos y reversibles | commitlint + Husky; migrate-mongo con `up`/`down`; feature flags; despliegue por tag que permite volver a cualquier versión; PR solo con "Rebase and merge" e historial lineal (sin squash ni merge commits). | ✅ |
| Restricciones (v1.1.0) | Node.js 24 LTS fijado en `.nvmrc`/`engines`/imágenes/CI; despliegue solo desde GitHub Actions con `railway up --ci`, autodeploy de Railway desactivado. | ✅ |
| V. Seguridad por defecto | Validación de config al arrancar; gitleaks en CI; secretos en GitHub Environments y Railway; Helmet y CORS restringido en `api`. | ✅ |
| VI. Observabilidad | `GET /health` en los tres servicios; logs JSON (pino / python-json-logger) con `x-request-id` propagado. | ✅ |
| VII. Humano en el bucle y simplicidad | Promoción a producción con aprobación manual; sin orquestador de monorepo (Turborepo/Nx) ni servicio externo de flags (YAGNI). | ✅ |

**Resultado**: todas las gates pasan; no hay violaciones que justificar.
**Re-evaluación post-diseño (Phase 1)**: sin cambios; el diseño de contratos y datos no introduce
dependencias nuevas ni colecciones compartidas.

## Project Structure

### Documentation (this feature)

```text
specs/001-plataforma-base/
├── plan.md              # Este archivo
├── research.md          # Phase 0: decisiones técnicas
├── data-model.md        # Phase 1: entidades de configuración, migraciones y flags
├── quickstart.md        # Phase 1: guía para validar la feature
├── contracts/
│   ├── health.openapi.yaml   # Contrato GET /health y GET /version
│   ├── env-vars.md           # Variables de entorno por servicio
│   └── ci-cd-pipeline.md     # Contrato de etapas y gates del pipeline
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/
├── web/                         # React + Vite + three.js
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx              # Página inicial "ReqCanvas" + versión
│   │   └── lib/config.ts
│   ├── public/health            # Healthcheck estático
│   ├── Caddyfile                # Servidor estático + SPA fallback
│   ├── Dockerfile
│   ├── railway.json
│   └── tests/
├── api/                         # Fastify + Mongoose + Socket.IO
│   ├── src/
│   │   ├── server.ts            # Bootstrap (escucha en "::" para la red privada IPv6)
│   │   ├── app.ts               # buildApp() testeable
│   │   ├── config/env.ts        # Validación zod de variables de entorno
│   │   ├── plugins/             # requestId, logger, helmet, cors, mongo, redis
│   │   ├── routes/health.ts
│   │   └── lib/flags.ts
│   ├── migrations/              # migrate-mongo (up/down)
│   ├── migrate-mongo-config.cjs
│   ├── Dockerfile
│   ├── railway.json
│   └── tests/{unit,integration,contract}/
└── analytics/                   # FastAPI (Python, gestionado con uv)
    ├── src/analytics/
    │   ├── main.py
    │   ├── config.py            # pydantic-settings
    │   ├── logging.py           # JSON + request_id
    │   └── routes/health.py
    ├── tests/{unit,contract}/
    ├── pyproject.toml
    ├── Dockerfile
    └── railway.json
packages/
└── shared/                      # Tipos y esquemas zod compartidos
    └── src/{health.ts,flags.ts,index.ts}
infra/
└── docker-compose.yml           # mongodb, redis, api, analytics, web
e2e/
└── smoke.spec.ts                # Playwright: smoke contra una URL base
docs/
├── adr/0001-monorepo-y-stack.md
├── adr/0002-despliegue-railway.md
└── runbooks/rollback.md
.github/
├── workflows/{ci.yml,deploy.yml,release.yml}
└── pull_request_template.md
commitlint.config.cjs, .husky/, eslint.config.js, .prettierrc, pnpm-workspace.yaml,
package.json, .gitleaks.toml, .env.example, README.md
```

**Structure Decision**: monorepo pnpm con `apps/{web,api,analytics}` y `packages/shared`,
tal como fija la constitución. `analytics` es un proyecto Python independiente dentro del
monorepo (uv), fuera del workspace de pnpm. Cada app tiene su `Dockerfile` y su `railway.json`,
y en Railway cada servicio apunta a la raíz del repositorio con su `dockerfilePath` y sus
`watchPatterns` propios.

## Complexity Tracking

Sin violaciones de la constitución que justificar.
