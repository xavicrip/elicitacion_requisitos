# ADR 0003: Rollback de migraciones y respaldos sin `railway ssh`

- **Estado**: aceptado
- **Fecha**: 2026-09-29
- **Feature**: 001-plataforma-base (T059, T061; sustituye el punto de R10 que usaba `railway ssh`)

## Contexto

`deploy.yml` revertía migraciones (`migrate-down`) y tomaba y restauraba respaldos
(`mongodump`/`mongorestore`) ejecutando comandos dentro de los contenedores con `railway ssh`.
`railway ssh` es interactivo y no funciona desde el runner de GitHub Actions con un project
token, así que esas acciones no podían ejecutarse. Exponer MongoDB con un proxy TCP para hacerlo
desde CI está descartado (S1).

## Decisión

1. **Todo pasa por el _pre-deploy command_ de `api`**, que ya corre dentro de la red privada:
   `node dist/migrate.js auto`, bajo el lock de migraciones existente. La variable
   `MIGRATION_ACTION` elige la acción:
   - `up` (por defecto): aplica las pendientes. Si alguna exporta `destructive = true`, antes
     guarda un respaldo en el bucket; si no puede, falla sin migrar y Railway conserva la
     versión anterior.
   - `down:<archivo>`: revierte las migraciones aplicadas desde `<archivo>`. Es idempotente:
     si ya no queda ninguna aplicada, no hace nada.
   - `restore:<clave>|latest`: restaura un respaldo una sola vez (marca en `ops_restores`) y
     aplica `up`.
2. **`deploy.yml` fija `MIGRATION_ACTION` en cada ejecución** (`--skip-deploys`) y la devuelve a
   `up` al terminar. `migrate-down` redespliega la versión **actual** de `api` (la que tiene los
   `down`), calculando el archivo con `scripts/first-new-migration.sh`; `restore-backup` es un
   despliegue normal del ref de destino.
3. **Respaldo lógico en Node** (`src/db/backup.ts`): NDJSON con EJSON canónico, comprimido con
   gzip, con opciones e índices de cada colección. Evita añadir `mongodump` a la imagen de `api`
   y se prueba en CI. Se guarda en un **Railway Bucket** (`reqcanvas`, uno por entorno) con
   `@aws-sdk/client-s3`; en local y en CI se usa **RustFS** (compatible con S3, Apache 2.0),
   porque MinIO dejó de publicar imágenes en Docker Hub.

## Consecuencias

- Revertir y restaurar no necesitan credenciales de MongoDB ni acceso interactivo, y siguen el
  mismo pipeline (aprobación en `production`, healthchecks, `/version`).
- El respaldo se construye en memoria: adecuado mientras la base mida decenas de MB. Si crece,
  habrá que pasar a subida en streaming (multipart).
- Railway Buckets no admite reglas de ciclo de vida: los respaldos (solo se crean antes de
  migraciones destructivas) se borran a mano.
- Las versiones anteriores a este cambio (hasta `v0.1.0`) no tienen `migrate.js auto`: su
  pre-deploy falla y Railway mantiene la versión actual. Para volver a ellas se usa el Rollback
  del panel o se cambia temporalmente el comando (runbook).
- Railway no lee `apps/api/railway.json` (ADR 0002): el nuevo _pre-deploy command_ y las
  variables del bucket se aplican a cada entorno cuando se despliega por primera vez código que
  los soporta.

## Configuración por entorno

Variables de `api` (referencias al bucket `reqcanvas` del mismo entorno):

| Variable                      | Valor                              |
| ----------------------------- | ---------------------------------- |
| `BACKUP_S3_ENDPOINT`          | `${{reqcanvas.ENDPOINT}}`          |
| `BACKUP_S3_BUCKET`            | `${{reqcanvas.BUCKET}}`            |
| `BACKUP_S3_REGION`            | `${{reqcanvas.REGION}}`            |
| `BACKUP_S3_ACCESS_KEY_ID`     | `${{reqcanvas.ACCESS_KEY_ID}}`     |
| `BACKUP_S3_SECRET_ACCESS_KEY` | `${{reqcanvas.SECRET_ACCESS_KEY}}` |
| `MIGRATION_ACTION`            | `up` (la gestiona `deploy.yml`)    |

_Pre-deploy command_ de `api`: `node dist/migrate.js auto`.
