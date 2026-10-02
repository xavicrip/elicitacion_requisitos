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

3. Para ocultar rutas de `api`, añade su patrón a `GATED_PREFIXES`
   (`apps/api/src/plugins/flags.ts`): con el flag desactivado responden 404. En `web`, envuelve
   la ruta o el componente en `<FlagGate flag="…">` (`apps/web/src/lib/flags.tsx`).

## Flags actuales

| Flag           | Por defecto | Feature                        | Qué oculta                                                                                                                                                               |
| -------------- | ----------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `realtime`     | `true`      | `005-colaboracion-tiempo-real` | Colaboración en tiempo real. Desactivado, `api` no monta el servidor Socket.IO (`/socket.io/`) y `web` no abre el socket: los cambios se ven al recargar, como en la 004 |
| `invite-email` | `false`     | `002-auth-proyectos`           | El envío de invitaciones por email (hasta tener un servicio de correo se copia el enlace)                                                                                |

`realtime` está activado por defecto desde T047 (2026-10-02), tras el recorrido en staging; se
retira en un cambio posterior y separado. `FEATURE_FLAGS=realtime=false` lo desactiva.

## Flags retirados

| Flag       | Feature                   | Activado por defecto | Retirado   |
| ---------- | ------------------------- | -------------------- | ---------- |
| `accounts` | `002-auth-proyectos`      | 2026-09-30 (T067)    | 2026-10-01 |
| `diagrams` | `003-diagramas-canvas`    | 2026-10-01 (T059)    | 2026-10-01 |
| `details`  | `004-detalles-requisitos` | 2026-10-01 (T053)    | 2026-10-01 |

## Activarlo por entorno

Variable `FEATURE_FLAGS` en Railway (o en `.env` en local):

```text
FEATURE_FLAGS=invite-email=true,detection=false
```

Un nombre desconocido o un valor distinto de `true`/`false` genera un aviso en el log y no
impide arrancar.

## Retirarlo

Cuando la funcionalidad esté completa y activa en producción, elimina el flag y sus
condicionales en un commit separado (`refactor(<alcance>): remove <flag> flag`).
