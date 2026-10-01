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
| `s3`        | RustFS (bucket S3; en Railway, un Bucket)  | (solo red interna) |

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
pnpm dev:up                        # construye y levanta los 6 servicios con Docker Compose
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

### Cuentas y proyectos (feature 002)

En local, `accounts` está activado: en `http://localhost:5173` puedes crear una cuenta
(`/registro`), iniciar sesión (`/entrar`), crear proyectos en "Mis proyectos" (`/proyectos`),
gestionar miembros e invitar con un enlace (`/invitacion/<token>`). `web` reenvía `/api/*` a
`api` (mismo origen: la cookie de sesión funciona con `SameSite=Strict`); ver
[ADR 0004](docs/adr/0004-sesion-y-proxy.md) y el
[quickstart de la 002](specs/002-auth-proyectos/quickstart.md).

| Servicio | Variable           | Obligatoria | Uso                                                           |
| -------- | ------------------ | ----------- | ------------------------------------------------------------- |
| `api`    | `JWT_SECRET`       | Sí          | Firma de los access tokens (≥ 32 bytes, distinto por entorno) |
| `api`    | `APP_BASE_URL`     | Sí          | URL pública de `web`; base de los enlaces de invitación       |
| `api`    | `JWT_ACCESS_TTL`   | No (`15m`)  | Duración del access token                                     |
| `api`    | `REFRESH_TTL_DAYS` | No (`7`)    | Validez deslizante de la sesión                               |
| `web`    | `API_INTERNAL_URL` | Sí          | Destino del proxy `/api` (`http://api:3000` en Compose)       |

Referencia completa: [`env-vars.md`](specs/001-plataforma-base/contracts/env-vars.md).

### Diagramas y espacio de trabajo (feature 003)

Detrás del flag `diagrams` (activado en Compose). Desde un proyecto, _Diagramas_ lista sus
diagramas con miniatura; el Administrador sube un PNG, JPG o SVG de hasta 10 MB, marca sus
actividades arrastrando sobre la imagen (nombre, tipo y transiciones, con guardado automático) y
publica la versión. Todos los miembros navegan el diagrama publicado en un canvas three.js: zoom
con la rueda o `+`/`-`, `0` para ajustar, minimapa, selección por clic o con el teclado (`Tab` +
`Enter`). En pantallas de menos de 768 px y en proyectos cerrados, solo lectura. Ver el
[quickstart de la 003](specs/003-diagramas-canvas/quickstart.md) y el
[ADR 0005](docs/adr/0005-imagenes-y-canvas.md).

Las imágenes se guardan en un bucket S3: en local, RustFS (servicio `s3` de Compose, que crea el
bucket al arrancar); en Railway, el Bucket de cada entorno. `api` las sirve por el proxy de `web`
con caché del navegador.

| Servicio | Variable                                                               | Obligatoria  | Uso                                                 |
| -------- | ---------------------------------------------------------------------- | ------------ | --------------------------------------------------- |
| `api`    | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Sí           | Bucket de las imágenes (en Railway, referencias)    |
| `api`    | `S3_REGION`                                                            | No (`auto`)  | Región S3                                           |
| `api`    | `S3_FORCE_PATH_STYLE`, `S3_CREATE_BUCKET`                              | No (`false`) | `true` solo con RustFS (local y CI)                 |
| `web`    | `E2E_HOOKS`                                                            | No           | `true` solo en Compose y CI: expone `__canvasState` |

Cada petición lleva un `x-request-id` que aparece en los logs JSON de todos los servicios:

```bash
curl -s -H "x-request-id: prueba-456" localhost:3000/health/deep > /dev/null
docker compose -f infra/docker-compose.yml logs api analytics | grep prueba-456
```

## Desarrollo

| Comando                                                                       | Qué hace                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm lint`                                                                   | ESLint + Ruff (Python)                                                    |
| `pnpm format:check` / `pnpm format`                                           | Prettier                                                                  |
| `pnpm typecheck`                                                              | TypeScript (todos los paquetes y `e2e/`) + mypy                           |
| `pnpm test:services:up` / `test:services:down`                                | MongoDB, Redis y S3 (RustFS) para las pruebas de integración              |
| `pnpm test`                                                                   | Vitest (shared, api, web) + pytest (analytics)                            |
| `pnpm e2e`                                                                    | Pruebas de humo contra `BASE_URL` / `API_URL` y, en local, los flujos E2E |
| `pnpm e2e:perf`                                                               | Mediciones de rendimiento del canvas (local, abre Chrome)                 |
| `pnpm --filter @reqcanvas/api migrate:up` / `migrate:down` / `migrate:status` | Migraciones (lee `MONGO_URL` y `MONGO_DB`)                                |
| `pnpm --filter @reqcanvas/api migrate:create <nombre>`                        | Nueva migración a partir de `migrations/sample-migration.js`              |

Las pruebas de integración necesitan MongoDB, Redis y un S3 (respaldos de migraciones e imágenes
de diagramas).
El stack de `pnpm dev:up` no los publica en el host; levántalos con:

```bash
pnpm test:services:up      # infra/docker-compose.test.yml: :27017, :6379 y :9000
pnpm test
pnpm test:services:down
```

Para usar otros, define `MONGO_TEST_URL`, `REDIS_TEST_URL` y `S3_TEST_URL`. Antes de la primera
ejecución de `pnpm e2e`, instala el navegador: `pnpm exec playwright install chromium`.

Para ejecutar un servicio fuera de Docker, copia `.env.example` a `.env` y usa
`pnpm --filter @reqcanvas/api dev`.

### Convenciones

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) con alcance
  (`feat(api): …`), validados por commitlint en el hook `commit-msg`. Cada commit es atómico
  y pasa las pruebas por sí solo; una prueba y su implementación van en el mismo commit.
- **Feature flags**: ver [`docs/feature-flags.md`](docs/feature-flags.md).
- **Migraciones**: siempre con `up` y `down`; las destructivas se declaran con
  `destructive: true` ([data model](specs/001-plataforma-base/data-model.md)).
