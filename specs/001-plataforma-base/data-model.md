# Data Model: Plataforma base y entrega continua

**Feature**: 001-plataforma-base | **Date**: 2026-09-25

Esta feature no introduce datos de negocio. Define las estructuras de soporte operativo.

## 1. Migración (colección `changelog` de MongoDB, gestionada por migrate-mongo)

| Campo | Tipo | Reglas |
|-------|------|--------|
| `fileName` | string | Único. Formato `YYYYMMDDHHmmss-descripcion.js`. |
| `appliedAt` | Date | Momento en que se aplicó. |
| `migrationBlock` | number | Lote de ejecución (permite revertir el último lote). |

**Transiciones**: *pendiente* → (`up`) → *aplicada* → (`down`) → *pendiente*.
**Regla**: toda migración DEBE implementar `up` y `down`; CI valida `up → down → up`.

Migración inicial `20260925000000-init-indexes.js`: crea la colección `_platform` con un
documento de versión del esquema (`{ _id: "schema", version: 1 }`); su `down` la elimina.
Sirve para validar el mecanismo de principio a fin.

## 2. Feature flag (código, `packages/shared/src/flags.ts`)

| Campo | Tipo | Reglas |
|-------|------|--------|
| `name` | string | kebab-case, único. |
| `description` | string | Obligatoria. |
| `default` | boolean | Valor si el entorno no lo define. |
| `owner` | string | Feature que lo introduce (p. ej., `006-deteccion-asistida`). |

Resolución: `FEATURE_FLAGS` (`nombre=true|false`, separados por comas) sobrescribe
`default`. Un nombre desconocido en `FEATURE_FLAGS` produce un aviso en el log, no un error.

## 3. Estado de salud (respuesta, `packages/shared/src/health.ts`)

| Campo | Tipo | Reglas |
|-------|------|--------|
| `status` | `"ok" \| "degraded"` | `ok` solo si todos los checks están en `up`. |
| `service` | `"api" \| "analytics" \| "web"` | |
| `version` | string | semver de la release o `dev`. |
| `commit` | string | SHA corto (`GIT_SHA`). |
| `checks` | `Record<string, {status:"up"\|"down", latencyMs:number, error?:string}>` | `error` sin datos sensibles. |
| `timestamp` | ISO-8601 | |

## 4. Configuración de servicio (variables de entorno)

Definidas en [contracts/env-vars.md](./contracts/env-vars.md). Reglas generales:
- Las variables obligatorias se validan al arrancar (el proceso termina con código 1 si falta alguna).
- Los secretos (`*_URL` con credenciales, `JWT_*`, tokens) nunca se registran en los logs.

## 5. Entorno

| Entorno | Origen del despliegue | Aprobación | Datos |
|---------|-----------------------|------------|-------|
| local | Docker Compose | — | Volúmenes locales, datos de ejemplo |
| staging | Push a `main` (CI verde) | Automática | Base de datos de staging |
| production | Tag `vX.Y.Z` o `workflow_dispatch` | Manual (GitHub Environment) | Base de datos de producción |
