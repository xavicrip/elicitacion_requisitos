# Quickstart: Plataforma base y entrega continua

Guía para validar la feature 001 de principio a fin. Cada paso indica qué historia o
requisito verifica.

## Prerrequisitos

- Git, Docker Desktop (o Docker Engine con Compose v2), Node.js 24 LTS con Corepack
  (`corepack enable`), Python 3.12 y uv.

## 1. Entorno local (US1, FR-002, SC-001)

```bash
git clone <repo> reqcanvas && cd reqcanvas
cp .env.example .env
pnpm install
pnpm dev:up          # docker compose -f infra/docker-compose.yml up -d --build
```

Validar:

```bash
curl -s localhost:3000/health | jq .status   # "ok"   (api)
curl -s localhost:8000/health | jq .status   # "ok"   (analytics)
curl -s -o /dev/null -w "%{http_code}" localhost:5173/health   # 200 (web)
open http://localhost:5173                   # Muestra "ReqCanvas" y la versión
```

## 2. Dependencia caída (US1 escenario 3, FR-003)

```bash
docker compose -f infra/docker-compose.yml stop mongodb
curl -s -w "\n%{http_code}\n" localhost:3000/health   # 503, checks.mongo.status = "down"
docker compose -f infra/docker-compose.yml start mongodb
```

## 3. Configuración obligatoria (FR-005)

```bash
MONGO_URL= pnpm --filter api start   # Termina con código 1 y el log indica "MONGO_URL" sin mostrar valores
```

## 4. Correlación de logs (FR-004)

```bash
curl -s -H "x-request-id: prueba-123" localhost:3000/health > /dev/null
docker compose -f infra/docker-compose.yml logs api | grep prueba-123   # Línea JSON con reqId "prueba-123"
```

## 5. Migraciones reversibles (FR-010, US4)

```bash
pnpm --filter api migrate:up
pnpm --filter api migrate:status     # init-indexes: APPLIED
pnpm --filter api migrate:down
pnpm --filter api migrate:status     # init-indexes: PENDING
```

## 6. Pruebas y calidad (US2)

```bash
pnpm lint && pnpm typecheck && pnpm test   # incluye pytest de analytics
git commit -m "cambios varios"             # Husky + commitlint lo rechazan
```

## 7. Pipeline y despliegue (US2, US3)

1. Abrir un PR con un error de lint → `ci / lint` en rojo, merge bloqueado.
2. Corregirlo → todos los checks en verde en < 15 min (SC-002).
3. Integrar en `main` → `deploy / staging` despliega; `curl $STAGING_API_URL/health` → `ok`
   en < 20 min (SC-003).
4. Integrar el PR de release-please → se crea el tag `vX.Y.Z` → aprobar en GitHub → producción.

## 8. Rollback (US4, SC-004)

Seguir `docs/runbooks/rollback.md`: Actions → `deploy` → *Run workflow* con
`ref=v<anterior>` y `environment=production`; verificar con `/version` que se sirve la
versión anterior en < 10 min.
