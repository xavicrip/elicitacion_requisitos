# Quickstart: Colaboración en tiempo real

Requiere 001–004 con el flag `realtime=true` (Compose lo activa). El reparto entre réplicas se
prueba en `api` con dos instancias de la app sobre el mismo Redis, y en staging con 2 réplicas.

## 1. Sincronización (US1)

1. Abrir el diagrama con Ana (Chrome) y con Luis (ventana privada de Firefox).
2. Luis crea un detalle en "Validar pago" → en < 1 s, Ana ve el contador +1 y, si tiene el
   panel abierto, el detalle nuevo.
3. Ana vota y valida el detalle → Luis ve el voto y el estado sin recargar.
4. En staging, con 2 réplicas, repetir el paso 2 comprobando en los logs que Ana y Luis están
   en réplicas distintas (líneas `socket.connected` con su `userId` y el campo `replica`).

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
pnpm test:services:up
pnpm --filter @reqcanvas/api exec vitest run realtime presence revocation cursors socket-events
pnpm dev:up && pnpm e2e --project flows
pnpm e2e --project perf -g realtime                         # 50 clientes (SC-001, SC-002, SC-004)
```
