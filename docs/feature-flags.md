# Feature flags

Los flags permiten integrar funcionalidades incompletas en `main` sin activarlas
(Principio IV de la constitución: commits reversibles).

## Crear un flag

1. Añádelo al registro `FLAGS` en `packages/shared/src/flags.ts`:

   ```ts
   export const FLAGS = defineFlags({
     detection: {
       description: 'Detección asistida de actividades',
       default: false,
       owner: '006-deteccion-asistida',
     },
   });
   ```

   - Nombre en _kebab-case_, único.
   - `default: false` mientras la funcionalidad esté incompleta.
   - `owner`: feature de spec-kit que lo introduce.

2. Léelo en la API con `loadFlags(process.env.FEATURE_FLAGS)` (`apps/api/src/lib/flags.ts`).
   El frontend recibe los flags activos en `GET /config`.

## Flags actuales

| Flag       | Por defecto | Feature              | Qué oculta                                                                                                                                                         |
| ---------- | ----------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accounts` | `true`      | `002-auth-proyectos` | Registro, login, "Mis proyectos" e invitaciones. Desactivado, las rutas `/auth`, `/me`, `/projects` e `/invitations` de `api` responden 404 y `web` no las muestra |

`accounts` está activado por defecto desde que se completó la 002 (T067, 2026-09-30). Para
ocultarlo en un entorno: `FEATURE_FLAGS=accounts=false`. Se retirará, con sus comprobaciones,
en un commit aparte.

## Flags retirados

| Flag       | Feature                   | Activado por defecto | Retirado   |
| ---------- | ------------------------- | -------------------- | ---------- |
| `diagrams` | `003-diagramas-canvas`    | 2026-10-01 (T059)    | 2026-10-01 |
| `details`  | `004-detalles-requisitos` | 2026-10-01 (T053)    | 2026-10-01 |

## Activarlo por entorno

Variable `FEATURE_FLAGS` en Railway (o en `.env` en local):

```text
FEATURE_FLAGS=diagrams=true,detection=false
```

Un nombre desconocido o un valor distinto de `true`/`false` genera un aviso en el log y no
impide arrancar.

## Retirarlo

Cuando la funcionalidad esté completa y activa en producción, elimina el flag y sus
condicionales en un commit separado (`refactor(<alcance>): remove <flag> flag`).
