# Quickstart: Plataforma base y entrega continua

Guía para validar la feature 001 de principio a fin. Cada paso indica qué historia o
requisito verifica.

## Prerrequisitos

- Git, Docker Desktop (o Docker Engine con Compose v2), Node.js 24 LTS (`nvm install && nvm use`
  con el `.nvmrc`) con Corepack (`corepack enable`), y uv (instala Python 3.12 si falta).

## 1. Entorno local (US1, FR-002, SC-001)

```bash
git clone https://github.com/xavicrip/elicitacion_requisitos.git reqcanvas && cd reqcanvas
pnpm install
(cd apps/analytics && uv sync)
pnpm dev:up          # docker compose -f infra/docker-compose.yml up -d --build
```

Validar:

```bash
curl -s localhost:3000/health | jq .status                         # "ok"   (api)
curl -s localhost:3000/health/deep | jq .checks.analytics.status   # "up"   (analytics vía api)
curl -s localhost:8000/health | jq .status                         # "ok"   (analytics, solo accesible en local)
curl -s -o /dev/null -w "%{http_code}\n" localhost:5173/health     # 200    (web)
open http://localhost:5173                                         # Muestra "ReqCanvas" y la versión
```

## 2. Dependencia caída (US1 escenario 3, FR-003)

```bash
docker compose -f infra/docker-compose.yml stop mongodb
curl -s -w "\n%{http_code}\n" localhost:3000/health   # 503, checks.mongo.status = "down"
docker compose -f infra/docker-compose.yml start mongodb
```

## 3. Configuración obligatoria (FR-005)

```bash
docker compose -f infra/docker-compose.yml run --rm --no-deps -e MONGO_URL= api node dist/server.js
# Termina con código 1 y el log indica "MONGO_URL" sin mostrar valores
docker compose -f infra/docker-compose.yml run --rm --no-deps -e API_PUBLIC_URL= web
# Termina con código 1 e indica "API_PUBLIC_URL"
```

## 4. Correlación de logs (FR-004)

```bash
curl -s -H "x-request-id: prueba-123" localhost:3000/health > /dev/null
docker compose -f infra/docker-compose.yml logs api | grep prueba-123         # Línea JSON con reqId "prueba-123"
curl -s -H "x-request-id: prueba-456" localhost:3000/health/deep > /dev/null
docker compose -f infra/docker-compose.yml logs analytics | grep prueba-456   # Propagado a analytics
```

## 5. Migraciones reversibles (FR-010, US4)

```bash
docker compose -f infra/docker-compose.yml exec api node dist/migrate.js status   # init-indexes: APPLIED
docker compose -f infra/docker-compose.yml exec api node dist/migrate.js down
docker compose -f infra/docker-compose.yml exec api node dist/migrate.js status   # init-indexes: PENDING
docker compose -f infra/docker-compose.yml exec api node dist/migrate.js up
```

Fuera de Docker: `pnpm --filter @reqcanvas/api migrate:up|down|status` (lee `MONGO_URL` y `MONGO_DB`).

## 6. Pruebas y calidad (US2)

```bash
pnpm lint && pnpm typecheck && pnpm test   # incluye pytest de analytics y las pruebas de scripts
pnpm e2e                                   # smoke contra el stack local (incluye p95 de /health)
git commit --allow-empty -m "cambios varios"   # Husky + commitlint lo rechazan
```

## 7. Pipeline y despliegue (US2, US3)

1. Abrir un PR con un error de lint → `ci / lint` en rojo, merge bloqueado (con la protección de
   `main` aplicada: `scripts/github/protect-main.sh`).
2. Corregirlo → todos los checks en verde en < 15 min (SC-002).
3. Integrar en `main` → `deploy` despliega en staging tras el CI; `curl $API_URL/health/deep` →
   `ok` en < 20 min (SC-003).
4. Integrar el PR de release-please → se crea el tag `vX.Y.Z` → aprobar en GitHub → producción.

## 8. Rollback (US4, SC-004)

Seguir `docs/runbooks/rollback.md`: `scripts/rollback.sh production v<anterior>`
(añade `--migrate-down` si la versión traía migraciones); verificar con `/version` que se sirve
la versión anterior en < 10 min.
