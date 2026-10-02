# ADR 0007: Colaboración en tiempo real con Socket.IO y el adaptador de Redis

- **Estado**: aceptado
- **Fecha**: 2026-10-01
- **Feature**: 005-colaboracion-tiempo-real (research R1–R8; plan, ajustes 1–12)

## Contexto

La 005 hace que los requisitos, votos y comentarios de la 004 aparezcan al instante para todos
los que están en el espacio de trabajo (p95 < 500 ms, SC-001), muestra quién está conectado y
sus cursores, y aplica al momento la retirada de un miembro o el cierre del proyecto. La `api`
corre en Railway con varias réplicas y sin sesiones persistentes (_sticky sessions_): dos
peticiones de un mismo cliente pueden llegar a réplicas distintas. La 004 ya emite eventos de
dominio tipados en proceso tras cada escritura confirmada.

## Decisión

1. **Socket.IO solo con WebSocket.** El sondeo largo (_long polling_) de Socket.IO necesita
   que todas las peticiones de una sesión lleguen a la misma réplica; sin sesiones persistentes
   en Railway, servidor y cliente usan `transports: ['websocket']`. El handshake lleva el access
   token de la 002 (`auth`), el socket se desconecta si caduca sin renovarse (`auth:refresh`) y
   cada evento del cliente se valida con zod y se autoriza contra la sala.
2. **Adaptador de Redis para repartir entre réplicas.** `@socket.io/redis-adapter`, sobre dos
   conexiones duplicadas del Redis existente, lleva cada emisión a las salas (`project:{id}`,
   `diagram:{versionId}`, `user:{id}`) de todas las réplicas. Un puente se suscribe al bus de
   eventos de dominio (`app.domainEvents`) y retransmite cada evento a la sala del proyecto con
   un `eventId` (UUID) para descartar duplicados en el cliente.
3. **El cliente aplica los payloads en lugar de volver a pedir.** Los eventos llevan el detalle
   o comentario completo, sin datos calculados por usuario; la web los aplica sobre la caché de
   TanStack Query y recalcula `permissions` y `votedByMe` con la misma regla que el servidor
   (`detailPermissions`, en `packages/shared`).
4. **Resincronizar invalidando, no reenviar lo perdido.** Al reconectar, el cliente vuelve a
   unirse a la sala e invalida las consultas del diagrama y del proyecto. El servidor no guarda
   un historial de eventos por cliente. Lo que se está escribiendo se conserva en un borrador
   en `localStorage`, y el evento `offline` del navegador cierra el transporte para avisar al
   momento.
5. **Presencia en Redis con barrido.** Un hash por diagrama con un campo por socket y la hora
   del último latido (cada 5 s); una réplica a la vez (bloqueo `SET NX`) barre los que llevan
   10 s sin latir y envía el estado completo (`presence:update`, ≤ 50 personas, agrupadas). Así
   sobrevive a que una réplica muera sin cerrar sus sockets.
6. **Revocación por eventos de dominio.** `member.removed`, `member.left`, `project.deleted` y
   `project.status_changed` se añaden al bus; la revocación avisa (`access:revoked`) y saca a
   los sockets afectados de las salas con `fetchSockets`, que funciona entre réplicas.
7. **Cursores volátiles en coordenadas de imagen.** `cursor:move` va en píxeles de la imagen,
   limitado a 20 por segundo y socket, y se retransmite con `volatile` sin el emisor: si un
   cliente va atrasado, se pierde un cursor en lugar de encolarse. La web los dibuja en una capa
   HTML sobre el canvas, interpolados con `requestAnimationFrame`, para no redibujar la escena
   de three.js (renderizada bajo demanda) en cada fotograma.
8. **Detrás del flag `realtime` mientras se construyó.** Sin él no se montaba el servidor de
   Socket.IO y la web era la de la 004; se activó por defecto tras el recorrido en staging y se
   retiró en la v0.6.0 (`docs/feature-flags.md`).

## Alternativas descartadas

- **Sondeo largo con sesiones persistentes**: Railway no las garantiza.
- **Publicar los eventos de dominio en un canal propio de Redis**: duplicaría lo que ya hace el
  adaptador, que además resuelve las salas y `fetchSockets` entre réplicas.
- **Volver a pedir la lista en cada evento**: con 50 personas, cada cambio serían 50 peticiones
  a la `api`; aplicar el payload no cuesta ninguna.
- **Reenviar los eventos perdidos durante una desconexión** (historial por cliente o
  _connection state recovery_ de Socket.IO): exige guardar eventos por sesión y no funciona
  entre réplicas sin más infraestructura; invalidar trae el estado actual con las consultas que
  ya existen.
- **Presencia en memoria de cada réplica**: cada réplica vería solo a sus sockets, y al caer una
  réplica sus personas quedarían «conectadas».
- **Servicio de tiempo real gestionado (Pusher, Ably, Liveblocks)**: otro proveedor y otra
  autorización que mantener para un volumen de 50 personas por diagrama.
