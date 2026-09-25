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

## Estado de la configuración (2026-09-25)

Proyecto `reqcanvas` (`a2c03e32-2a46-46e8-910d-54331d424225`), creado con la CLI de Railway:

| Entorno      | web                                         | api                                        |
| ------------ | ------------------------------------------- | ------------------------------------------ |
| `production` | https://web-production-aaa68.up.railway.app | https://api-production-6963.up.railway.app |
| `staging`    | https://web-staging-0562.up.railway.app     | https://api-staging-e244.up.railway.app    |

`analytics`, `MongoDB` y `Redis` solo tienen endpoint privado. `staging` se creó duplicando
`production`.

Diferencias respecto a lo previsto:

- **Ruta del _config as code_**: la configuración de entorno de Railway acepta el campo
  `configFile` pero lo ignora, y `railway up` solo lee un `railway.json` en la raíz del código
  subido. Por eso los valores de `apps/<servicio>/railway.json` (builder, Dockerfile, healthcheck, reinicios, `preDeployCommand`) se aplicaron a cada servicio con
  `railway environment edit`, generando el patch desde esos mismos archivos. Los `railway.json`
  siguen siendo la fuente de verdad (los valida el CI); si cambian, hay que volver a aplicar el
  patch en ambos entornos.
- **Plantilla de MongoDB**: se desplegó sin el _TCP proxy_ público que trae por defecto (S1), sin
  la variable `MONGO_PUBLIC_URL` que dependía de él, y con la imagen `mongo:7` en lugar de
  `mongo:latest`, para coincidir con el CI y el entorno local.
- **Redis**: la plantilla usa `redis:8.2` (el CI y el entorno local usan Redis 7; la API solo
  usa comandos compatibles).
- **`restartPolicyType`**: `ON_FAILURE` es el valor por defecto de Railway y no aparece en la
  configuración; `restartPolicyMaxRetries: 3` sí.
- **Sin `watchPatterns`**: Railway los aplica también a los despliegues por CLI y marcaba como
  `SKIPPED` los commits que no tocaban `apps/<servicio>/**` (p. ej., solo documentación), dejando
  staging en una versión anterior. Como el CI decide qué se despliega, se eliminaron de los
  `railway.json` y de ambos entornos.
- **Espera por versión**: `railway up --ci` termina al acabar el build y la versión anterior sigue
  sirviendo hasta que la nueva pasa su healthcheck; `deploy.yml` espera a que `api /version` y
  `web /config.js` muestren el commit nuevo antes de los smoke tests.
