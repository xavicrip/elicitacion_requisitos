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

## Recorrido en staging (T046, 2026-10-02)

Con un Administrador y dos Participantes nuevos, sobre `289ce45` (flag `realtime` activado solo
en staging). Automatizado con Playwright y la ventana visible; como en staging no hay
`__canvasState`, las actividades se eligen con la lista accesible del canvas, que centra la
cámara en la actividad.

| § | Comprobación | Resultado |
|---|--------------|-----------|
| — | WebSocket a través del borde de Railway y el proxy de `web` | Los tres navegadores conectados y unidos a la sala (`/socket.io`, solo WebSocket) |
| 1 | Luis crea un detalle en "Validar pago" | Aparece en el panel de Ana en 217 ms, contando el `POST` |
| 1 | Ana vota y valida | Luis ve "1 voto(s)" y "Validado" sin recargar |
| 2 | Presencia con tres cuentas | Cada una ve a las otras dos; la selección de Luis aparece en "Emitir factura" para Ana; una segunda pestaña no lo duplica |
| 3 | Cursores con Ana a 195 % y Luis a 51 % | El cursor de Luis cae sobre "Validar pago" en la pantalla de Ana (a menos de 6 px del centro); "Ocultar cursores" lo oculta |
| 4 | Luis sin red | Aviso y guardar deshabilitado; al volver ve los 2 detalles que Ana creó mientras tanto y conserva su borrador |
| 4 | Ana retira a Luis | Luis vuelve a "Mis proyectos" con "Ya no tienes acceso a este proyecto." en 480 ms |
| 4 | Ana cierra el proyecto | Marta pasa a solo lectura sin recargar |

Latencia de extremo a extremo (8 sockets de `socket.io-client` desde el equipo local contra staging, 20
detalles, 160 recepciones): del envío del `POST` a la llegada del evento, p50 213 ms y p95
552 ms; `recepción − at` (solo el reparto desde que el servidor confirma la escritura; relojes
sincronizados por NTP), p50 70 ms y p95 95 ms (SC-001: < 500 ms). Ningún evento se perdió. El
p95 del extremo a extremo incluye la ida y vuelta del `POST` hasta Railway (`us-west2`), que no
forma parte de la propagación.

Réplicas: el plan de Railway de la cuenta no aplicó las 2 réplicas de `api` (la configuración
del entorno sigue en 1 y los logs muestran un solo `RAILWAY_REPLICA_ID`), así que el reparto entre
réplicas queda validado por las pruebas de integración con dos instancias de la app sobre el
mismo Redis (`realtime-sync`, `presence`, `revocation`, `cursors`), no en staging.

- El proyecto y las cuentas de prueba (`e2e-…@example.com`) se quedan en staging: no hay borrado
  de cuentas.

## 5. Pruebas y carga

```bash
pnpm test:services:up
pnpm --filter @reqcanvas/api exec vitest run realtime presence revocation cursors socket-events
pnpm dev:up && pnpm e2e --project flows
pnpm e2e --project perf -g realtime                         # 50 clientes (SC-001, SC-002, SC-004)
```
