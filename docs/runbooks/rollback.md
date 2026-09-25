# Runbook: rollback de un despliegue

Objetivo (SC-004): volver a la versión anterior en **menos de 10 minutos**, con los datos
incluidos. Requiere `gh` autenticado y permisos para ejecutar workflows; en `production`, la
aprobación del Environment.

## 1. Decidir el tipo de rollback

| Situación                                                   | Procedimiento                                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| La versión nueva falla y **no** incluía migraciones         | [A. Solo código](#a-solo-código)                                                                     |
| Incluía migraciones **no destructivas**                     | [B. Código + migración](#b-código--migración)                                                        |
| Incluía una migración **destructiva** (`destructive: true`) | [C. Restaurar el respaldo](#c-migración-destructiva-restaurar-el-respaldo)                           |
| Emergencia: hay que cortar el daño en segundos              | [D. Rollback inmediato en Railway](#d-rollback-inmediato-desde-el-panel-de-railway) y luego A, B o C |

Para saber qué migraciones trae una versión:

```bash
git diff --name-only --diff-filter=A <tag-anterior> <tag-actual> -- apps/api/migrations
grep -l 'destructive = true' apps/api/migrations/*.js
```

## A. Solo código

```bash
scripts/rollback.sh production v0.1.0
```

Redespliega el tag anterior con `deploy.yml` (mismo pipeline: build en Railway, healthchecks,
smoke tests y aprobación en `production`).

## B. Código + migración

```bash
scripts/rollback.sh production v0.1.0 --migrate-down
```

El orden importa y el script lo respeta: **primero** revierte la última migración con el código
nuevo aún desplegado (es el que contiene su `down`) y **después** redespliega el tag anterior.
Si la versión trajo varias migraciones, repite la acción `migrate-down` tantas veces como
migraciones nuevas haya antes de redesplegar:

```bash
gh workflow run deploy.yml -f environment=production -f ref=main -f action=migrate-down
```

## C. Migración destructiva: restaurar el respaldo

Antes de aplicar una migración con `destructive: true`, `deploy.yml` guarda un `mongodump` como
artefacto `mongo-backup-<entorno>-<commit>` (30 días) en esa ejecución.

1. Localiza la ejecución de despliegue que guardó el respaldo:
   ```bash
   gh run list --workflow deploy.yml --limit 10
   ```
2. Redespliega el código anterior (A).
3. Restaura el respaldo (sustituye los datos actuales con `mongorestore --drop`):
   ```bash
   gh workflow run deploy.yml -f environment=production -f ref=v0.1.0 \
     -f action=restore-backup -f backup_run_id=<id-de-la-ejecución>
   ```

> Los datos escritos después de tomar el respaldo se pierden. Coordina una ventana de
> mantenimiento si es producción.

## D. Rollback inmediato desde el panel de Railway

Railway → proyecto `reqcanvas` → entorno → servicio (`api`, `web` o `analytics`) →
_Deployments_ → despliegue anterior → **Rollback**. Es instantáneo (reutiliza la imagen ya
construida), pero **no** revierte migraciones: continúa después con B o C si las hubo.

## Si `railway ssh` no está disponible

`migrate-down` y `restore-backup` ejecutan comandos dentro de los contenedores con
`railway ssh`. Si la CLI del runner no lo permite, ejecútalos desde la consola del servicio en
el panel de Railway:

```bash
# servicio api
node dist/migrate.js down
# servicio MongoDB (subiendo antes el archivo del respaldo)
mongorestore --uri "$MONGO_URL" --archive=backup.archive.gz --gzip --drop
```

## Verificación

```bash
curl -s "$API_URL/version"            # versión y commit esperados
curl -s "$API_URL/health/deep" | jq .status
gh run list --workflow deploy.yml --limit 3
```

## Registro de ensayos (T061)

| Fecha       | Entorno | De → a          | Con migración  | Duración | Resultado |
| ----------- | ------- | --------------- | -------------- | -------- | --------- |
| _pendiente_ | staging | v0.1.1 → v0.1.0 | Sí (de prueba) |          |           |
