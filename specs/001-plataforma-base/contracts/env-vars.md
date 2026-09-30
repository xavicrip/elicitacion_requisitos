# Contrato: variables de entorno por servicio

Los valores de ejemplo están en `.env.example`. En Railway, las variables de las bases de datos
se definen como referencias (`${{MongoDB.MONGO_URL}}`), no como valores copiados.

## api

| Variable | Obligatoria | Ejemplo / valor en Railway | Descripción |
|----------|-------------|-----------------------------|-------------|
| `NODE_ENV` | Sí | `production` | `development` \| `test` \| `production` |
| `PORT` | Sí | Asignada por Railway | Puerto HTTP |
| `HOST` | No | `::` | Dirección de escucha (IPv6, necesaria para la red privada) |
| `MONGO_URL` | Sí | `${{MongoDB.MONGO_URL}}` | Conexión a MongoDB |
| `MONGO_DB` | Sí | `reqcanvas` | Nombre de la base de datos |
| `REDIS_URL` | Sí | `${{Redis.REDIS_URL}}` | Conexión a Redis |
| `ANALYTICS_URL` | Sí | `http://analytics.railway.internal:${{analytics.PORT}}` | URL interna de analytics |
| `CORS_ORIGINS` | Sí | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` | Orígenes permitidos (separados por comas) |
| `LOG_LEVEL` | No | `info` | Nivel de log de pino |
| `FEATURE_FLAGS` | No | `detection=false` | Sobrescritura de flags |
| `GIT_SHA` | No | `${{RAILWAY_GIT_COMMIT_SHA}}` o valor inyectado por CI | Commit desplegado |
| `APP_VERSION` | No | Inyectado por CI | Versión semver |
| `JWT_SECRET` | Sí | Secreto aleatorio por entorno (≥ 32 bytes; `openssl rand -base64 48`) | Firma de los access tokens (feature 002). Solo en Railway, nunca en el repositorio ni en GitHub |
| `JWT_ACCESS_TTL` | No | `15m` | Duración del access token (`<n><s\|m\|h\|d>`) |
| `REFRESH_TTL_DAYS` | No | `7` | Validez deslizante del refresh token (1–90 días) |
| `APP_BASE_URL` | Sí | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` | URL pública de `web`; base de los enlaces de invitación |
| `MIGRATION_ACTION` | No | `up` (la fija `deploy.yml`) | Acción del pre-deploy: `up`, `down:<archivo>`, `restore:<clave>\|latest` (ADR 0003) |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | Para migraciones destructivas | `${{reqcanvas.ENDPOINT}}`, `${{reqcanvas.BUCKET}}`… | Bucket de respaldos; sin él, una migración destructiva no se aplica |
| `BACKUP_S3_REGION` | No | `${{reqcanvas.REGION}}` | Región S3 (`auto` por defecto) |
| `BACKUP_S3_FORCE_PATH_STYLE` | No | `true` solo con RustFS/MinIO | URLs path-style en lugar de virtual-hosted |

## analytics

| Variable | Obligatoria | Ejemplo | Descripción |
|----------|-------------|---------|-------------|
| `ENV` | Sí | `production` | Entorno |
| `PORT` | Sí | Asignada por Railway | Puerto HTTP |
| `MONGO_URL` | Sí | `${{MongoDB.MONGO_URL}}` | Conexión a MongoDB |
| `MONGO_DB` | Sí | `reqcanvas` | Nombre de la base de datos |
| `REDIS_URL` | Sí | `${{Redis.REDIS_URL}}` | Conexión a Redis |
| `LOG_LEVEL` | No | `INFO` | Nivel de log |
| `GIT_SHA`, `APP_VERSION` | No | Inyectados | Versión desplegada |

## web

| Variable | Obligatoria | Ejemplo | Descripción |
|----------|-------------|---------|-------------|
| `PORT` | Sí | Asignada por Railway | Puerto de Caddy |
| `API_INTERNAL_URL` | Sí | `http://api.railway.internal:3000` (Compose: `http://api:3000`) | Destino del proxy `/api/*` de Caddy (feature 002, research R2) |
| `API_PUBLIC_URL` | No | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` | Se escribe en `/config.js`; opcional desde la feature 002 (el frontend usa rutas relativas `/api`) |

## GitHub (secrets y variables por Environment)

Cada GitHub Environment (`staging`, `production`) define los mismos nombres con sus propios
valores; los jobs de `deploy.yml` los leen del Environment en el que se ejecutan.

| Nombre | Tipo | Descripción |
|--------|------|-------------|
| `RAILWAY_TOKEN` | secret | Project token de Railway del entorno correspondiente |
| `BASE_URL` | variable | URL pública de `web` (smoke tests y enlace del Environment) |
| `API_URL` | variable | URL pública de `api` (smoke tests; `analytics` se verifica vía `/health/deep`) |

> Las migraciones no necesitan credenciales en GitHub: se ejecutan como *pre-deploy command*
> del servicio `api` en Railway, dentro de la red privada. MongoDB no tiene proxy TCP público.
