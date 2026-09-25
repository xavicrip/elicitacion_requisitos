# Quickstart: Colaboración en tiempo real

Requiere 001–004 con el flag `realtime=true`. Para probar el escalado horizontal:
`pnpm dev:up -- --scale api=2` (Caddy reparte las conexiones entre las dos réplicas).

## 1. Sincronización (US1)

1. Abrir el diagrama con Ana (Chrome) y con Luis (ventana privada de Firefox).
2. Luis crea un detalle en "Validar pago" → en < 1 s, Ana ve el contador +1 y, si tiene el
   panel abierto, el detalle nuevo.
3. Ana vota y valida el detalle → Luis ve el voto y el estado sin recargar.
4. Con `--scale api=2`, repetir el paso 2 comprobando en los logs que Ana y Luis están en
   réplicas distintas.

## 2. Presencia (US2)

1. Con tres cuentas conectadas, cada una ve a las otras dos en la barra de presencia.
2. Luis selecciona "Emitir factura" → los demás ven su color en esa actividad.
3. Luis abre una segunda pestaña → sigue apareciendo una sola vez. Cierra ambas → desaparece
   en ≤ 10 s.

## 3. Cursores (US3)

1. Ana con zoom al 200 % y Luis al 50 %: el cursor de Luis sobre una actividad aparece sobre la
   misma actividad en la pantalla de Ana.
2. Ana activa "Ocultar cursores" → deja de verlos.

## 4. Reconexión y revocación (US4, edge cases)

1. En las DevTools de Luis, *Network → Offline* → aviso "Sin conexión" y guardar deshabilitado;
   Luis escribe un borrador.
2. Ana crea 2 detalles. Luis vuelve a *Online* → ve los 2 detalles y conserva su borrador.
3. Ana retira a Luis del proyecto → Luis ve "Ya no tienes acceso" al instante.
4. Ana cierra el proyecto → las demás sesiones pasan a solo lectura sin recargar.

## 5. Pruebas y carga

```bash
pnpm --filter api test -- realtime
pnpm e2e -- realtime-sync presence reconnect
# Carga (manual, contra staging; SC-001/SC-002):
gh workflow run load.yml -f target=staging
```
