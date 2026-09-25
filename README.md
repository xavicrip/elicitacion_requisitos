# ReqCanvas

Sistema web colaborativo para levantar requisitos a partir de diagramas UML de actividades:
los participantes registran escenarios **Dado / Cuando / Entonces** sobre cada actividad de un
diagrama, y el administrador los analiza con técnicas de minería de datos y de texto.

- Visión y alcance: [`prompt.md`](prompt.md)
- Principios del proyecto: [`.specify/memory/constitution.md`](.specify/memory/constitution.md)
- Roadmap y specs (spec-kit): [`specs/`](specs/) — una rama por feature (`NNN-nombre`)

## Arquitectura

| Servicio    | Tecnología                                 | Puerto local       |
| ----------- | ------------------------------------------ | ------------------ |
| `web`       | React + Vite + three.js, servido por Caddy | 5173               |
| `api`       | Node.js 24 + Fastify + Mongoose            | 3000               |
| `analytics` | Python 3.12 + FastAPI                      | 8000               |
| `mongodb`   | MongoDB 7                                  | (solo red interna) |
| `redis`     | Redis 7                                    | (solo red interna) |

```text
apps/web          Frontend
apps/api          API REST (y tiempo real a partir de la feature 005)
apps/analytics    Servicio analítico (OCR, detección, minería de texto)
packages/shared   Esquemas zod y tipos compartidos (contratos web ⇄ api)
infra/            Docker Compose para desarrollo local
e2e/              Pruebas de humo (Playwright)
```

## Prerrequisitos

- **Docker** con Compose v2 (Docker Desktop en macOS/Windows).
- **Node.js 24 LTS** (fijado en [`.nvmrc`](.nvmrc); con nvm: `nvm install && nvm use`).
- **pnpm 10** mediante Corepack: `corepack enable` (la versión la fija `packageManager`).
- **Python 3.12** y **[uv](https://docs.astral.sh/uv/)** (uv descarga Python 3.12 si hace falta).

## Arranque local

```bash
git clone https://github.com/xavicrip/elicitacion_requisitos.git reqcanvas
cd reqcanvas
pnpm install                       # dependencias de Node + hooks de git (Husky)
(cd apps/analytics && uv sync)     # dependencias de Python
pnpm dev:up                        # construye y levanta los 5 servicios con Docker Compose
```

`pnpm dev:up` aplica las migraciones de MongoDB antes de arrancar la API (igual que el
_pre-deploy_ de Railway). Para detenerlo todo: `pnpm dev:down`.

### Verificar que todo está saludable

```bash
curl -s localhost:3000/health | jq .status                         # "ok"  (api: mongo + redis)
curl -s localhost:3000/health/deep | jq .checks.analytics.status   # "up"  (analytics vía api)
curl -s localhost:8000/health | jq .status                         # "ok"  (analytics, solo en local)
curl -s -o /dev/null -w "%{http_code}\n" localhost:5173/health     # 200   (web)
open http://localhost:5173                                         # "ReqCanvas" y la versión
```

Si una dependencia falla, `/health` responde **503** con `status: "degraded"` e indica cuál:

```bash
docker compose -f infra/docker-compose.yml stop mongodb
curl -s -w "\n%{http_code}\n" localhost:3000/health   # 503, checks.mongo.status = "down"
docker compose -f infra/docker-compose.yml start mongodb
```

Cada petición lleva un `x-request-id` que aparece en los logs JSON de todos los servicios:

```bash
curl -s -H "x-request-id: prueba-456" localhost:3000/health/deep > /dev/null
docker compose -f infra/docker-compose.yml logs api analytics | grep prueba-456
```

## Desarrollo

| Comando                                                                       | Qué hace                                                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm lint`                                                                   | ESLint + Ruff (Python)                                                      |
| `pnpm format:check` / `pnpm format`                                           | Prettier                                                                    |
| `pnpm typecheck`                                                              | TypeScript (todos los paquetes y `e2e/`) + mypy                             |
| `pnpm test`                                                                   | Vitest (shared, api, web) + pytest (analytics)                              |
| `pnpm e2e`                                                                    | Pruebas de humo contra `BASE_URL` / `API_URL` (por defecto, el stack local) |
| `pnpm --filter @reqcanvas/api migrate:up` / `migrate:down` / `migrate:status` | Migraciones (lee `MONGO_URL` y `MONGO_DB`)                                  |
| `pnpm --filter @reqcanvas/api migrate:create <nombre>`                        | Nueva migración a partir de `migrations/sample-migration.js`                |

Las pruebas de integración necesitan MongoDB y Redis. Por defecto usan `localhost:27017` y
`localhost:6379`; para usar otros, define `MONGO_TEST_URL` y `REDIS_TEST_URL`, p. ej.:

```bash
docker run -d --rm --name rc-test-mongo -p 27018:27017 mongo:7
docker run -d --rm --name rc-test-redis -p 6380:6379 redis:7
MONGO_TEST_URL=mongodb://localhost:27018 REDIS_TEST_URL=redis://localhost:6380 pnpm test
```

Para ejecutar un servicio fuera de Docker, copia `.env.example` a `.env` y usa
`pnpm --filter @reqcanvas/api dev`.

### Convenciones

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) con alcance
  (`feat(api): …`), validados por commitlint en el hook `commit-msg`. Cada commit es atómico
  y pasa las pruebas por sí solo; una prueba y su implementación van en el mismo commit.
- **Feature flags**: ver [`docs/feature-flags.md`](docs/feature-flags.md).
- **Migraciones**: siempre con `up` y `down`; las destructivas se declaran con
  `destructive: true` ([data model](specs/001-plataforma-base/data-model.md)).
