# Contrato: pipeline de CI/CD

## `ci.yml` — en cada `pull_request` y en cada push a `main`

| Job | Depende de | Qué valida | Falla si… |
|-----|-----------|------------|-----------|
| `lint` | — | ESLint, Prettier (`--check`), Ruff | Hay cualquier error de estilo |
| `typecheck` | — | `tsc --noEmit` (todo el workspace), `mypy apps/analytics` | Hay errores de tipos |
| `commitlint` | — | Mensajes de los commits del PR (Conventional Commits) | Algún commit no cumple el formato |
| `secrets` | — | gitleaks sobre el diff | Se detecta un secreto |
| `test-node` | — | Vitest (unit, contract, integration) con servicios `mongo:7` y `redis:7` | Una prueba falla o la cobertura de `api` es < 70 % |
| `test-python` | — | pytest con servicios `mongo:7` y `redis:7` | Una prueba falla o la cobertura es < 70 % |
| `migrations` | — | `migrate-mongo up → down → up` sobre una Mongo efímera | Alguna migración no es reversible |
| `build` | `lint`, `typecheck` | `docker buildx` de `web`, `api` y `analytics` (con caché de GHA) | Alguna imagen no se construye |
| `e2e-smoke` | `build` | `docker compose up` + Playwright `e2e/smoke.spec.ts` | La página inicial o algún `/health` falla |

Todos son *required status checks* en la protección de rama de `main`.

## `deploy.yml`

| Disparador | Entorno | Pasos |
|------------|---------|-------|
| `workflow_run` de `ci.yml` exitoso en `main` | `staging` | 1. `migrate-mongo up` (staging) → 2. `railway up --ci --service api/analytics/web --environment staging` (en paralelo) → 3. esperar a que `/health` responda `200` → 4. Playwright smoke contra staging |
| Push de tag `v*.*.*` o `workflow_dispatch` (`ref`, `environment`) | `production` | Requiere aprobación del GitHub Environment `production` → mismos pasos contra production |
| `workflow_dispatch` con `action=migrate-down` | elegido | `migrate-mongo down` (revierte el último lote) |

Reglas:
- `concurrency: deploy-${{ environment }}` con `cancel-in-progress: false` (los despliegues se
  ejecutan en orden).
- Si falla el smoke en staging, el job falla y no se crea ninguna release; GitHub notifica
  a quien hizo el push.

## `release.yml`

- `release-please` en push a `main`: mantiene un PR de release con `CHANGELOG.md`; al
  integrarlo, crea el tag `vX.Y.Z`, que dispara el despliegue a producción (con aprobación).
