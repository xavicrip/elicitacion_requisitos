# ADR 0002: Despliegue en Railway desde GitHub Actions

- **Estado**: aceptado
- **Fecha**: 2026-09-25
- **Feature**: 001-plataforma-base (research R9, R10; constitución v1.1.0)

## Contexto

prompt.md exige desplegar en Railway con CI/CD. La constitución (v1.1.0) fija que los
despliegues se hacen **solo desde GitHub Actions**, con aprobación manual para producción,
y el análisis de la spec (S1) descartó exponer MongoDB para migrar desde CI.

## Decisión

1. **Un proyecto de Railway** con dos entornos (`staging`, `production`) y cinco servicios:

   | Servicio    | Origen                     | Dominio público           | Config as code                |
   | ----------- | -------------------------- | ------------------------- | ----------------------------- |
   | `web`       | CLI (`railway up`)         | Sí                        | `apps/web/railway.json`       |
   | `api`       | CLI (`railway up`)         | Sí                        | `apps/api/railway.json`       |
   | `analytics` | CLI (`railway up`)         | **No** (solo red privada) | `apps/analytics/railway.json` |
   | `MongoDB`   | Plantilla de base de datos | **No** (sin proxy TCP)    | —                             |
   | `Redis`     | Plantilla de base de datos | No                        | —                             |

2. **Despliegue**: `deploy.yml` sube el código con `railway up --ci` usando un project token
   por entorno (GitHub Environments). El **autodeploy de Railway queda desactivado** (los
   servicios no se conectan al repositorio de GitHub), así que nada llega a un entorno sin
   pasar por el CI.
3. **Migraciones**: `preDeployCommand` de `api` (`node dist/migrate.js up`), dentro de la red
   privada. Si falla, Railway mantiene la versión anterior.
4. **Salud**: Railway usa `/health` de cada servicio para promover un despliegue. `api /health`
   no depende de `analytics`; los smoke tests usan `api /health/deep`.
5. **Versión**: `deploy-service.sh` fija `APP_VERSION` y `GIT_SHA` como variables del
   servicio; Railway las pasa como _build args_ y como variables de ejecución (`/version`).

## Configuración inicial (T052)

1. Crear el proyecto `reqcanvas` y el entorno `staging` (además de `production`).
2. Añadir las plantillas **MongoDB** y **Redis** en ambos entornos, sin _TCP proxy_ público.
3. Crear los servicios vacíos `api`, `analytics` y `web` y, en cada uno, fijar la ruta del
   _config as code_ (`apps/<servicio>/railway.json`). No conectar el repositorio.
4. Variables por servicio (referencias de Railway, idénticas en ambos entornos):

   | Servicio    | Variables                                                                                                                                                                                                                                                               |
   | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `api`       | `NODE_ENV=production`, `MONGO_URL=${{MongoDB.MONGO_URL}}`, `MONGO_DB=reqcanvas`, `REDIS_URL=${{Redis.REDIS_URL}}`, `ANALYTICS_URL=http://${{analytics.RAILWAY_PRIVATE_DOMAIN}}:${{analytics.PORT}}`, `CORS_ORIGINS=https://${{web.RAILWAY_PUBLIC_DOMAIN}}`, `PORT=3000` |
   | `analytics` | `ENV=production`, `MONGO_URL=${{MongoDB.MONGO_URL}}`, `MONGO_DB=reqcanvas`, `REDIS_URL=${{Redis.REDIS_URL}}`, `PORT=8000`                                                                                                                                               |
   | `web`       | `API_PUBLIC_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}`, `PORT=8080`                                                                                                                                                                                                    |

5. Generar dominios públicos para `web` y `api` (no para `analytics`).
6. Crear un **project token** por entorno y registrarlo en los GitHub Environments
   ([runbook](../runbooks/github-environments.md)).

## Consecuencias

- Rollback reproducible: `deploy.yml` con `workflow_dispatch` y el tag anterior, o "Rollback"
  en el panel de Railway ([runbook](../runbooks/rollback.md)).
- `railway up` construye en Railway a partir del código subido; la imagen no se reutiliza entre
  entornos (se reconstruye con el mismo commit). Si se quisiera _build once, deploy many_
  estricto, habría que publicar las imágenes en un registro y desplegarlas por digest.
- Los entornos efímeros por PR quedan fuera de esta iteración (supuesto de la spec).
