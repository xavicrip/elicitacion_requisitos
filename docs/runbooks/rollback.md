# Runbook: rollback de un despliegue

Objetivo (SC-004): volver a la versión anterior en **menos de 10 minutos**, con los datos
incluidos. Requiere `gh` autenticado y permisos para ejecutar workflows; en `production`, la
aprobación del Environment.

Nada de este runbook usa `railway ssh` ni exige exponer MongoDB: revertir migraciones y restaurar
respaldos son **redespliegues** de `api` cuyo _pre-deploy command_ (`node dist/migrate.js auto`)
lee la variable `MIGRATION_ACTION` ([ADR 0003](../adr/0003-migraciones-sin-ssh.md)).

| `MIGRATION_ACTION`        | Qué hace el pre-deploy de `api`                                                      |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `up` (por defecto)        | Aplica las pendientes; si alguna es `destructive: true`, respalda antes en el bucket |
| `down:<archivo>`          | Revierte las migraciones aplicadas desde `<archivo>` (inclusive), de la última atrás |
| `restore:<clave>\|latest` | Restaura ese respaldo del bucket (una sola vez por clave) y después aplica `up`      |

`deploy.yml` fija la variable en cada ejecución y la devuelve a `up` al terminar, así que no hay
que tocarla a mano.

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

1. `deploy.yml` (`action=migrate-down`) lee el commit desplegado en `api /version`, calcula la
   migración más antigua que `v0.1.0` no tiene (`scripts/first-new-migration.sh`) y redespliega
   **la versión actual** de `api` (la que contiene los `down`) con
   `MIGRATION_ACTION=down:<archivo>`. Todas las migraciones nuevas se revierten en ese único
   despliegue; `/version` muestra `<versión>-migrate-down` cuando termina.
2. Después, el script redespliega `v0.1.0` (acción `deploy`).

Si el `down` falla, Railway no promueve el despliegue: sigue sirviendo la versión anterior, el
job agota la espera y el log del pre-deploy (panel de Railway → `api` → despliegue fallido)
indica la migración que falló.

## C. Migración destructiva: restaurar el respaldo

Antes de aplicar una migración con `destructive: true`, el pre-deploy de `api` guarda un
respaldo lógico de la base en el bucket del entorno (`mongo-backups/<timestamp>-<versión>.ndjson.gz`)
y deja la clave en su log (`Respaldo guardado antes de las migraciones destructivas`). Si no
puede respaldar (bucket sin configurar o inaccesible), **no aplica la migración** y el despliegue
falla.

```bash
scripts/rollback.sh production v0.1.0 --restore-backup            # el respaldo más reciente
scripts/rollback.sh production v0.1.0 --restore-backup=<clave>    # uno concreto
```

Es un único despliegue de `v0.1.0` cuyo pre-deploy restaura el respaldo (cada colección
respaldada se borra y se recrea, incluido el `changelog` de migraciones) y luego aplica `up`,
que no encuentra nada pendiente. La restauración se registra en la colección `ops_restores`: un
redespliegue posterior con la misma clave no vuelve a restaurar.

> Los datos escritos después de tomar el respaldo se pierden, y la versión nueva sigue sirviendo
> mientras se restaura. Coordina una ventana de mantenimiento si es producción.

## D. Rollback inmediato desde el panel de Railway

Railway → proyecto `reqcanvas` → entorno → servicio (`api`, `web` o `analytics`) →
_Deployments_ → despliegue anterior → **Rollback**. Es instantáneo (reutiliza la imagen ya
construida), pero **no** revierte migraciones: continúa después con B o C si las hubo.

## Versiones anteriores a `migrate.js auto`

Las versiones publicadas antes de este mecanismo (hasta `v0.1.0`) no conocen el comando `auto`:
si se redespliegan con `deploy.yml`, su pre-deploy termina con error y Railway **mantiene** la
versión actual (no hay caída). Para volver a una de ellas, usa D, o cambia temporalmente el
_pre-deploy command_ del entorno a `node dist/migrate.js up` y restáuralo después.

## Verificación

```bash
curl -s "$API_URL/version"            # versión y commit esperados
curl -s "$API_URL/health/deep" | jq .status
gh run list --workflow deploy.yml --limit 3
```

## Activar el mecanismo en un entorno

Railway no lee `apps/api/railway.json` (ADR 0002), así que en cada entorno hay que hacerlo a
mano, **en este orden** y comprobando en el panel que el selector muestra el entorno correcto:

1. Variables `BACKUP_S3_*` de `api` con referencias al bucket **de ese entorno**
   (`reqcanvas` en `production`, `reqcanvas-staging` en `staging`; ADR 0003).
2. Desplegar una versión que incluya `migrate.js auto`.
3. Después, cambiar el _pre-deploy command_ de `api` a `node dist/migrate.js auto` y aplicar.
4. Comprobar: `railway environment config --environment <entorno> --json` muestra el comando, y
   el log del pre-deploy del siguiente despliegue dice `migraciones del despliegue`.

Estado: `staging` activado el 2026-09-29; `production`, pendiente de la release que lo incluya.

## Registro de ensayos (T061)

Los tiempos van desde el disparo del workflow hasta que `api /version` muestra la versión de
destino con `/health/deep` en `ok`.

| Fecha      | Entorno | De → a                              | Procedimiento                    | Duración    | Resultado                                                                                                    |
| ---------- | ------- | ----------------------------------- | -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| 2026-09-29 | staging | `e1b79cc` → `687b250`               | B: `migrate-down` + redespliegue | 19 min 59 s | ✅ Migración de prueba revertida (`reverted=[…ensayo-t061.js]`); smoke en verde                              |
| 2026-09-29 | staging | `8cd3992` (destructiva) → `5350d00` | C: `restore-backup` (`latest`)   | 8 min 19 s  | ✅ Respaldo tomado antes de migrar y restaurado (`changelog`, `_platform`); `MIGRATION_ACTION` vuelve a `up` |

Observaciones:

- **B supera el objetivo de 10 min** porque encadena dos despliegues y cada uno tarda en Railway
  8–10 min (build incluido; el 2026-09-25 eran ~6 min). C cumple porque es un solo despliegue.
  Para cortar el daño en menos de 10 min, usa primero D (Rollback del panel, instantáneo).
- Sin bucket configurado, el pre-deploy **se negó a aplicar** la migración destructiva y Railway
  mantuvo la versión anterior (primer intento del ensayo C, con referencias a un bucket con otro
  nombre).
- `railway up --ci` fallaba al perder el stream de logs de build aunque el build siguiera;
  `deploy-service.sh` ahora sigue el estado del despliegue (`railway up --detach`).
