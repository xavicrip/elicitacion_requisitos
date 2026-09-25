# Research: Colaboración en tiempo real

**Feature**: 005-colaboracion-tiempo-real | **Date**: 2026-09-25

## R1. Transporte y escalado horizontal

- **Decision**: Socket.IO 4 con `transports: ['websocket']` en cliente y servidor, más
  `@socket.io/redis-adapter` (pub/sub en el Redis de Railway). El proxy Caddy de `web` enruta
  `/socket.io/*` a `api` (con WebSocket upgrade).
- **Rationale**: el *long-polling* de Socket.IO exige sesiones persistentes (*sticky*), que el
  balanceador de Railway no garantiza; con solo WebSocket cualquier réplica sirve la conexión
  y el adaptador reparte las emisiones entre réplicas (FR-009).
- **Alternatives considered**: WebSocket nativo (`ws`) con pub/sub propio (reimplementa salas,
  reconexión y *acks*); servicios gestionados como Ably o Pusher (otra dependencia de pago y
  datos fuera de Railway).

## R2. Autenticación y autorización

- **Decision**: el cliente envía el access token en `auth.token` del *handshake*; un
  middleware lo verifica y fija `socket.data.userId`. `room:join {versionId}` comprueba la
  membresía en el proyecto de la versión (la misma función que el guard REST) y une el socket a
  `project:{projectId}`, `diagram:{versionId}` y `user:{userId}`. Cuando el token caduca, el
  cliente llama a `/auth/refresh` y envía `auth:refresh`; si no se renueva en 60 s, el
  servidor desconecta el socket.
- **Rationale**: FR-002 y Principio V.

## R3. Propagación de cambios

- **Decision**: `bridge.ts` se suscribe a los eventos de dominio de la 004 y hace
  `io.to('project:{id}').emit(evento, payload)`. El emisor también recibe su propio evento
  (idempotente en el cliente, que compara por `id` y `rev`). El cliente aplica `setQueryData`
  sobre las consultas afectadas (panel de la actividad, cobertura) o invalida si no las tiene
  en caché. Cambios del diagrama publicado (`diagram.published`) → invalidar la versión.
- **Rationale**: el flujo REST sigue siendo la única vía de escritura (una sola fuente de
  verdad); el socket solo notifica.

## R4. Reconexión y resincronización

- **Decision**: al reconectar (`socket.io` reintenta con backoff exponencial de 0,5 a 5 s), el
  cliente vuelve a unirse a las salas y ejecuta `queryClient.invalidateQueries({queryKey:
  ['diagram', versionId]})`, que vuelve a pedir la cobertura y el panel abierto. Durante la
  desconexión se muestra `ConnectionBanner` y se deshabilitan los botones de guardar.
  Los borradores del formulario se guardan en `localStorage` (`draft:{versionId}:{activityKey}`)
  en cada cambio, con debounce de 300 ms, y se restauran al volver.
- **Rationale**: SC-003 (el 100 % de los cambios se refleja al volver) sin guardar un
  historial de eventos en el servidor; una recarga completa del estado de un diagrama cuesta
  < 200 KB.
- **Alternatives considered**: *connection state recovery* de Socket.IO (no es compatible con
  el adaptador Redis de pub/sub; requeriría el adaptador de Redis Streams y aun así tiene
  ventanas limitadas).

## R5. Presencia

- **Decision**: hash Redis `presence:{versionId}` con el campo `userId` y el valor JSON
  `{name, color, sockets: n, selectedActivityKey, lastSeen}`. *Heartbeat* del cliente cada
  5 s; el servidor elimina las entradas con `lastSeen > 10 s` (barrido cada 5 s por réplica,
  con un bloqueo `SET NX` para que lo haga una sola). El color es un hash estable de `userId`
  sobre una paleta de 12 colores accesibles. Cambios → `presence:update` a la sala del diagrama.
- **Rationale**: US2 (desaparece a los 10 s) y el edge case de varias pestañas (contador de
  `sockets`).

## R6. Cursores en vivo

- **Decision**: el cliente emite `cursor:move {x, y}` en coordenadas de **imagen** (con
  `screenToImage` de la 003), limitado con `throttle` a 50 ms; el servidor valida y
  retransmite con `socket.volatile.to('diagram:{v}').emit` (se descarta si el cliente va
  atrasado). Los clientes interpolan (lerp) entre posiciones para suavizar el movimiento y
  ocultan los cursores sin actualizaciones durante 5 s. La preferencia "ocultar cursores" se
  guarda en `localStorage`.
- **Rationale**: US3 con zoom distinto en cada cliente; el envío volátil evita la congestión
  (edge case de muchos cursores).

## R7. Revocación inmediata

- **Decision**: la 002 emite los eventos de dominio `member.removed` y
  `project.status_changed`. `revocation.ts`: en `member.removed`,
  `io.in('user:{uid}').socketsLeave('project:{pid}')` y emite `access:revoked`; en `closed`,
  emite `project:closed` a la sala (el cliente pasa a solo lectura).
- **Rationale**: FR-008.

## R8. Medición de latencia y carga

- **Decision**: cada evento de dominio incluye `at` (hora del servidor); la prueba E2E mide
  `recepción - at` con relojes sincronizados en el mismo host. El escenario de Artillery simula
  50 usuarios que se unen, mueven el cursor a 20 Hz y crean 1 detalle cada 30 s durante 5 min;
  el umbral es p95 < 500 ms. Se ejecuta en un job `load` manual del CI contra staging.
