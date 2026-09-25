# Runbook: GitHub Environments (staging y production)

`deploy.yml` se ejecuta dentro de un GitHub Environment, que aporta el token de Railway, las
URLs de los smoke tests y, en `production`, la **aprobación manual** (FR-009).

| Environment  | Aprobación          | Ramas/tags permitidos | Secret          | Variables             |
| ------------ | ------------------- | --------------------- | --------------- | --------------------- |
| `staging`    | No                  | Cualquiera            | `RAILWAY_TOKEN` | `BASE_URL`, `API_URL` |
| `production` | Revisor obligatorio | `main` y tags `v*`    | `RAILWAY_TOKEN` | `BASE_URL`, `API_URL` |

- `RAILWAY_TOKEN`: **project token** de Railway del entorno correspondiente
  (Railway → proyecto → _Settings → Tokens_, uno para `staging` y otro para `production`).
- `BASE_URL` / `API_URL`: dominios públicos de `web` y `api` en ese entorno.

## Crear o actualizar

Requiere `gh` con permisos de administrador y que el proyecto de Railway exista
([ADR 0002](../adr/0002-despliegue-railway.md)).

```bash
STAGING_RAILWAY_TOKEN=… PRODUCTION_RAILWAY_TOKEN=… \
STAGING_BASE_URL=https://web-staging.up.railway.app STAGING_API_URL=https://api-staging.up.railway.app \
PRODUCTION_BASE_URL=https://web.up.railway.app PRODUCTION_API_URL=https://api.up.railway.app \
scripts/github/setup-environments.sh
```

El script es idempotente. Los tokens se pasan por variable de entorno y se envían a `gh secret
set` por stdin: no quedan en el historial de la shell si se exportan desde un gestor de
secretos.

## Verificación

```bash
gh api repos/{owner}/{repo}/environments --jq '.environments[] | {name, rules: [.protection_rules[].type]}'
gh variable list --env staging
gh secret list --env production
```

Con un único mantenedor, `prevent_self_review` queda en `false` para poder aprobar tus propios
despliegues; cámbialo a `true` cuando haya otro revisor.

## Estado (2026-09-25)

Configurados con `scripts/github/setup-environments.sh` tras hacer público el repositorio (en un
repositorio privado del plan gratuito, GitHub no ofrece Environments ni protección de ramas).
Los _project tokens_ de Railway (`github-actions-staging`, `github-actions-production`) se
crearon con la API de Railway y se enviaron a `gh secret set` por stdin, sin mostrarse ni
guardarse en disco. Para rotarlos: crear un token nuevo en Railway, volver a ejecutar el script
y borrar el anterior en Railway.
