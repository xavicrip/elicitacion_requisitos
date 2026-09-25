# Feature flags

Los flags permiten integrar funcionalidades incompletas en `main` sin activarlas
(Principio IV de la constitución: commits reversibles).

## Crear un flag

1. Añádelo al registro `FLAGS` en `packages/shared/src/flags.ts`:

   ```ts
   export const FLAGS = defineFlags({
     'diagram-editor': {
       description: 'Editor de zonas de actividad',
       default: false,
       owner: '003-diagramas-canvas',
     },
   });
   ```

   - Nombre en _kebab-case_, único.
   - `default: false` mientras la funcionalidad esté incompleta.
   - `owner`: feature de spec-kit que lo introduce.

2. Léelo en la API con `loadFlags(process.env.FEATURE_FLAGS)` (`apps/api/src/lib/flags.ts`).
   El frontend recibe los flags activos en `GET /config`.

## Activarlo por entorno

Variable `FEATURE_FLAGS` en Railway (o en `.env` en local):

```text
FEATURE_FLAGS=diagram-editor=true,detection=false
```

Un nombre desconocido o un valor distinto de `true`/`false` genera un aviso en el log y no
impide arrancar.

## Retirarlo

Cuando la funcionalidad esté completa y activa en producción, elimina el flag y sus
condicionales en un commit separado (`refactor(<alcance>): remove <flag> flag`).
