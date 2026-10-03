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
3. **Migraciones**: `preDeployCommand` de `api` (`node dist/migrate.js auto`, ver
   [ADR 0003](0003-migraciones-sin-ssh.md)), dentro de la red
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

## Variables de la feature 002 (2026-09-30)

Configuradas en ambos entornos antes de integrar la 002 (T065; ADR 0004), con `--skip-deploys`:

| Servicio | Variable           | Staging                                    | Producción                               |
| -------- | ------------------ | ------------------------------------------ | ---------------------------------------- |
| `api`    | `JWT_SECRET`       | Secreto propio (`openssl rand -base64 48`) | Secreto propio, distinto del de staging  |
| `api`    | `APP_BASE_URL`     | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}`   | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |
| `api`    | `FEATURE_FLAGS`    | `accounts=true`                            | Sin definir (`accounts` desactivado)     |
| `web`    | `API_INTERNAL_URL` | `http://api.railway.internal:3000`         | `http://api.railway.internal:3000`       |

`JWT_ACCESS_TTL` y `REFRESH_TTL_DAYS` usan sus valores por defecto (15 min y 7 días). Sin
`JWT_SECRET` o `APP_BASE_URL`, `api` no arranca y Railway mantiene la versión anterior. Tras el
primer despliegue de la 002 se comprueba en `/health/deep` que Redis no avisa de
`maxmemory-policy` (BullMQ exige `noeviction`).

## Variables de la feature 003 (2026-09-30)

Configuradas en ambos entornos antes de integrar la 003 (T057), como referencias al bucket del
entorno: el mismo que los respaldos de migraciones (ADR 0003), con las imágenes bajo el prefijo
`projects/`. Comprobado que coinciden con `BACKUP_S3_*` sin mostrar sus valores.

| Servicio | Variable               | Staging                                    | Producción                           |
| -------- | ---------------------- | ------------------------------------------ | ------------------------------------ |
| `api`    | `S3_ENDPOINT`          | `${{reqcanvas-staging.ENDPOINT}}`          | `${{reqcanvas.ENDPOINT}}`            |
| `api`    | `S3_BUCKET`            | `${{reqcanvas-staging.BUCKET}}`            | `${{reqcanvas.BUCKET}}`              |
| `api`    | `S3_REGION`            | `${{reqcanvas-staging.REGION}}`            | `${{reqcanvas.REGION}}`              |
| `api`    | `S3_ACCESS_KEY_ID`     | `${{reqcanvas-staging.ACCESS_KEY_ID}}`     | `${{reqcanvas.ACCESS_KEY_ID}}`       |
| `api`    | `S3_SECRET_ACCESS_KEY` | `${{reqcanvas-staging.SECRET_ACCESS_KEY}}` | `${{reqcanvas.SECRET_ACCESS_KEY}}`   |
| `api`    | `FEATURE_FLAGS`        | `accounts=true,diagrams=true`              | Sin definir (`diagrams` desactivado) |

`S3_FORCE_PATH_STYLE` y `S3_CREATE_BUCKET` quedan en `false` (solo RustFS los necesita) y
`E2E_HOOKS` no se define nunca en Railway. Sin las `S3_*`, `api` no arranca y Railway mantiene la
versión anterior; una caída del bucket solo se refleja en `/health/deep` (check `storage`), no en
el healthcheck de despliegue.

## Variables de la feature 004 (2026-10-01)

La 004 no necesita variables nuevas. Antes de integrarla (T051), `FEATURE_FLAGS` de `api` en
staging pasa a `accounts=true,diagrams=true,details=true`; producción sigue sin definirla
(`details` desactivado hasta completar la feature).

## Flags retirados (2026-10-01)

`accounts`, `diagrams` y `details` se retiraron tras la v0.5.0 (`docs/feature-flags.md`): sus
funcionalidades ya no dependen de `FEATURE_FLAGS`. La variable de `api` en staging se elimina
después de desplegar el retiro; mientras siga definida, `api` solo avisa en el log de los flags
desconocidos. Producción nunca la definió.

## Variables y réplicas de la feature 005 (2026-10-02)

Antes de integrar la 005 (T045), `api` en staging tiene `FEATURE_FLAGS=realtime=true`.
Producción sigue sin definirla (`realtime` desactivado). No hacen falta variables nuevas:
Socket.IO usa el Redis existente y Railway pone `RAILWAY_REPLICA_ID`, que aparece en los logs de
conexión (`socket.connected`).

El plan preveía 2 réplicas de `api` en staging para validar el reparto entre réplicas (ADR 0007),
pero el plan de Railway de la cuenta solo admite una: el panel no muestra el número de réplicas y
`railway environment edit -e staging --service-config api deploy.multiRegionConfig.us-west2.numReplicas 2`
no cambió la configuración. Staging y producción siguen con una réplica; el reparto entre
réplicas queda validado por las pruebas de integración con dos instancias de la app sobre el
mismo Redis. Al pasar a un plan con réplicas, se aplica ese mismo comando (y se añade
`environments.staging.deploy.multiRegionConfig` a `apps/api/railway.json`, que es la fuente de
verdad) y se repite la comprobación de T046 con los logs de conexión.

## Flag `realtime` retirado (2026-10-02)

`realtime` se activó por defecto en la v0.6.0 y se retiró después (`docs/feature-flags.md`). La
variable `FEATURE_FLAGS` de `api` en staging se elimina después de desplegar el retiro; mientras
siga definida, `api` solo avisa en el log del flag desconocido. Producción nunca la definió.

## Servicio `analytics-worker` de la feature 006 (2026-10-02)

La 006 añade un sexto servicio de aplicación, `analytics-worker` (ADR 0008): la imagen de
`analytics` con otro comando, que consume la cola `detection` de BullMQ. Sin dominio público y
sin `preDeployCommand`. Su configuración está en `apps/analytics/railway.worker.json` (fuente de
verdad, validada por `tests/repo/railway-config.test.ts`); como el resto, Railway no la lee y se
aplica con `railway environment edit`. `deploy.yml` lo despliega en el mismo bucle que los demás
servicios; `scripts/rollback.sh` no cambia porque relanza `deploy.yml`.

Lo crea el propietario en staging y producción **antes de fusionar** (si no existe, el paso de
despliegue falla):

| Ajuste        | Valor                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| Origen        | CLI (`railway up`), Dockerfile `apps/analytics/Dockerfile`                             |
| Start command | `python -m analytics.worker`                                                           |
| Healthcheck   | `GET /health` (Redis y bucle de BullMQ vivos), reinicio `ON_FAILURE` ×3                |
| Variables     | `REDIS_URL=${{Redis.REDIS_URL}}`, `DETECTION_CONCURRENCY=1`, `DETECTION_TIMEOUT_S=180` |
| Opcional      | `ANTHROPIC_API_KEY` (y `DETECTION_LLM_MODEL`) solo si se quiere el refinamiento        |

Railway pone `PORT`. `api` en staging pasa a `FEATURE_FLAGS=detection=true`; producción sigue
sin definirla (`detection` desactivado). Con el flag activo, `api /health/deep` incluye el check
`detection-worker`, que comprueba el latido del worker en Redis: los smoke tests del despliegue
cubren así un worker caído.

Estado (2026-10-02): `analytics-worker` creado como servicio vacío (sin repositorio) en
staging y producción, con la configuración de `railway.worker.json` y las variables
`REDIS_URL`, `DETECTION_CONCURRENCY=1`, `DETECTION_TIMEOUT_S=180` y `LOG_LEVEL=INFO`, sin
`ANTHROPIC_API_KEY`. `railway add` solo creó la instancia del entorno enlazado (producción) y
`railway environment edit` no admite `isCreated`: la de staging se creó con la mutación
`environmentPatchCommit` de la API de Railway y el mismo parche. `api` en staging tiene `FEATURE_FLAGS=detection=true`; producción sigue sin definirla.

## Flag `detection` retirado (2026-10-02)

`detection` se activó por defecto tras el recorrido en staging (T052) y se retiró después
(`docs/feature-flags.md`): `api` monta siempre la cola de la detección y `/health/deep` incluye
siempre el check `detection-worker`, así que `analytics-worker` debe estar desplegado en cada
entorno. La variable `FEATURE_FLAGS=detection=true` de `api` en staging se elimina después de
desplegar el retiro; mientras siga definida, `api` solo avisa en el log del flag desconocido.
Producción nunca la definió. `detection-llm` sigue como flag operativo.

## Servicio `analysis-worker` de la feature 007 (2026-10-03)

La 007 añade un séptimo servicio de aplicación, `analysis-worker` (ADR 0009): consume la cola
`analysis` de BullMQ y ejecuta la minería del dashboard. A diferencia de `analytics-worker`,
tiene **imagen propia** (`apps/analytics/Dockerfile.mining`, ~3 GB: spaCy, sentence-transformers
y el modelo de sentimiento van dentro, sin descargas en ejecución). Sin dominio público y sin
`preDeployCommand`; no accede a MongoDB: lee la entrada y escribe los resultados en el bucket con
URLs prefirmadas que le pasa `api`. Su configuración está en `apps/analytics/railway.mining.json`
(validada por `tests/repo/railway-config.test.ts`) y se aplica con `railway environment edit`.
`deploy.yml` lo despliega en el mismo bucle que los demás servicios.

Lo crea el propietario en staging y producción **antes de fusionar** (si no existe, el paso de
despliegue falla):

| Ajuste        | Valor                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| Origen        | CLI (`railway up`), Dockerfile `apps/analytics/Dockerfile.mining`              |
| Start command | `python -m analytics.mining.worker`                                            |
| Healthcheck   | `GET /health` (Redis y bucle de BullMQ vivos), 300 s, reinicio `ON_FAILURE` ×3 |
| Variables     | `REDIS_URL=${{Redis.REDIS_URL}}`, `ANALYSIS_TIMEOUT_S=900`, `LOG_LEVEL=INFO`   |
| Opcional      | `ANTHROPIC_API_KEY` (y `INSIGHTS_LLM_MODEL`) solo si se quieren los insights   |
| Memoria       | Al menos 4 GB (modelos en memoria más UMAP/HDBSCAN con 5 000 detalles)         |

`api` en staging pasa a `FEATURE_FLAGS=dashboard=true`; producción sigue sin definirla
(`dashboard` desactivado) hasta el recorrido en staging. Con el flag activo, `api /health/deep`
incluye el check `analysis-worker` (latido del worker en Redis), de modo que los smoke tests del
despliegue cubren un worker caído. El build de la imagen es el más lento del despliegue (descarga
de modelos); cabe en el `DEPLOY_TIMEOUT` de 1 500 s de `scripts/railway/deploy-service.sh`.
