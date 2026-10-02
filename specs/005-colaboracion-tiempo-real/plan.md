# Implementation Plan: Colaboración en tiempo real

**Branch**: `005-colaboracion-tiempo-real` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-colaboracion-tiempo-real/spec.md`

## Summary

Socket.IO montado en `api` (mismo origen gracias al proxy `/socket.io` de la 002), solo con
transporte WebSocket y con el **adaptador Redis** para funcionar con varias réplicas sin
sesiones persistentes. Los eventos de dominio de la 004 se retransmiten a la sala
`project:{id}`; el cliente aplica cada evento sobre la caché de TanStack Query y, al
reconectar, invalida las consultas del diagrama para resincronizar. La **presencia** se guarda
en Redis (hash por diagrama, con TTL y *heartbeat*) agregada por usuario (varias pestañas
cuentan como una). Los **cursores** se envían como eventos volátiles, limitados a 20 Hz, en
coordenadas de imagen. Retirar a un miembro o cerrar el proyecto se aplica al instante
desconectando o degradando sus sockets. Los borradores se guardan en `localStorage` por
actividad.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 24 LTS
**Primary Dependencies**: `socket.io` 4, `@socket.io/redis-adapter`, `ioredis`; `socket.io-client` en `web` y en las pruebas
**Storage**: Redis (pub/sub del adaptador, presencia `presence:{versionId}`); sin colecciones nuevas en MongoDB
**Testing**: Vitest con servidor Socket.IO real y varios clientes (autorización de salas, fan-out, presencia, revocación); dos instancias de la app sobre el mismo Redis para el reparto entre réplicas; Playwright con varios contextos de navegador; un script de `socket.io-client` con 50 clientes en `e2e/perf` (ajustes 5 y 12)
**Target Platform**: Web; `api` escalable a N réplicas en Railway
**Project Type**: Aplicación web
**Performance Goals**: p95 < 500 ms extremo a extremo (SC-001, RNF-02); 50 usuarios por diagrama (SC-002)
**Constraints**: sin *sticky sessions* en Railway → solo `transports: ['websocket']`; autorización por evento; cursores ≤ 20 Hz por cliente
**Scale/Scope**: ≤ 50 conectados por diagrama; ≤ 500 conexiones simultáneas por réplica

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento | Estado |
|-----------|--------------|--------|
| I. Requisito anclado a la actividad | No cambia el modelo; solo transporta los eventos de la 004. | ✅ N/A |
| II. Servicios desacoplados | Contrato de eventos en `contracts/socket-events.md` y tipado en `packages/shared/src/realtime.ts`; la lógica de negocio sigue en REST y el socket solo notifica. | ✅ |
| III. Pruebas primero | Pruebas de integración con varios clientes y dos réplicas, y E2E multi-contexto, antes de implementar. | ✅ |
| IV. Commits atómicos y reversibles | Todo detrás del flag `realtime`: sin él, la app funciona como en la 004 (recarga al abrir el panel). | ✅ |
| V. Seguridad por defecto | Autenticación con el JWT en el *handshake* (el socket se desconecta si el token caduca sin renovarse), pertenencia verificada al unirse a cada sala y en cada evento de cliente, rate limit por socket, validación zod de los payloads. | ✅ |
| VI. Observabilidad | Métricas en log de conexiones por réplica, latencia de *ping* y eventos descartados por rate limit. | ✅ |
| VII. Simplicidad | Resincronizar invalidando las consultas (en lugar de reenviar eventos perdidos); sin CRDT. | ✅ |
| Restricciones (v1.1.0) | Node 24; Socket.IO; el despliegue desde GitHub Actions no cambia (las réplicas las configura el propietario en Railway). | ✅ |

**Re-evaluación post-diseño**: sin violaciones.

## Project Structure

### Documentation (this feature)

```text
specs/005-colaboracion-tiempo-real/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/socket-events.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/realtime.ts                 # Tipos ServerToClient/ClientToServer + esquemas zod
apps/api/src/realtime/
├── server.ts                                   # Socket.IO + redis adapter + auth middleware
├── rooms.ts                                    # join/leave con verificación de membresía
├── bridge.ts                                   # eventos de dominio (004) → emit a salas
├── presence.ts                                 # Redis hash + heartbeat + limpieza
├── cursors.ts                                  # relay volátil con throttle
├── revocation.ts                               # member.removed / project.closed → sockets
└── rate-limit.ts
apps/web/src/features/realtime/
├── socket.ts                                   # cliente único, reconexión, token
├── useRealtimeSync.ts                          # eventos → setQueryData / invalidate
├── usePresence.ts, PresenceBar.tsx
├── CursorsLayer.tsx                            # capa three.js/HTML sobre el canvas
├── ConnectionBanner.tsx                        # "Sin conexión: reintentando"
└── drafts.ts                                   # borradores en localStorage
apps/api/railway.json                           # numReplicas configurable
e2e/flows/{realtime-sync,presence,reconnect}.spec.ts
e2e/perf/realtime.perf.spec.ts                  # 50 clientes con socket.io-client
```

**Structure Decision**: carpeta `realtime/` en `api` (transversal, no un módulo de dominio);
feature `realtime` en `web`, que se engancha al workspace mediante `useWorkspaceEvents` y
`overlays.presence` (contrato de la 003).

## Ajustes tras implementar la 002, la 003 y la 004 (2026-10-01)

1. **Versiones reales**: `socket.io` 4 y `@socket.io/redis-adapter` sobre el `ioredis` del
   plugin de la 002 (`apps/api/src/plugins/redis.ts`; el adaptador usa dos conexiones propias
   con `duplicate()`), zod 4 para los payloads y el JWT de `@fastify/jwt` (`{ sub, sid }`, 15 min)
   para el *handshake*, verificado con `app.jwt.verify`.
2. **Flag `realtime`** (`default: false`, owner `005-colaboracion-tiempo-real`). Socket.IO
   atiende `/socket.io/` fuera del router de Fastify, así que `GATED_PREFIXES` no sirve: con el
   flag desactivado no se monta el servidor, y `web` no abre el socket (`useFlags`). Se activa
   por defecto al cerrar la feature y se retira después, como `accounts`, `diagrams` y `details`.
3. **Proxy**: el `Caddyfile` de `web` no tiene `/socket.io`. Se añade `handle /socket.io/*` con
   `reverse_proxy {$API_INTERNAL_URL}` y la misma `X-Real-IP` (`handle`, no `handle_path`:
   Socket.IO espera el prefijo; Caddy pasa el *upgrade* a WebSocket sin más configuración), y
   `'/socket.io': { ws: true }` en el proxy de Vite. En staging se comprueba que el borde de
   Railway mantiene el WebSocket abierto (el *ping* de Socket.IO es cada 25 s).
4. **Eventos de dominio**: la 004 solo tiene `app.detailEvents` (`apps/api/src/modules/details/
   events.ts`, en proceso y sin datos por usuario) y `bridge.ts` se suscribe con `onAny`.
   Faltan los eventos de fuera de los detalles: `diagram.published` (publicar en
   `diagrams/service.ts`), `project.status_changed` (`changeStatus` en `projects/service.ts`),
   `member.removed` y `member.left` (`members.ts`) y `project.deleted`. El bus se generaliza a
   `app.domainEvents` con los tipos de `packages/shared/src/events.ts` ampliados; la auditoría
   de los detalles sigue igual (los cambios de proyecto y miembros ya se auditan en la 002).
5. **Varias réplicas**: `api` tiene hoy una réplica. El evento se emite en la réplica que hizo
   la escritura y `io.to(sala).emit` lo reparte por Redis a los sockets de todas: no hace falta
   publicar los eventos en Redis por separado (la consecuencia que dejó abierta el ADR 0006).
   La prueba de dos réplicas son dos instancias de `buildTestApp` escuchando en puertos
   distintos con el mismo Redis, en Vitest, en lugar de escalar Compose. En staging se valida
   con 2 réplicas (`numReplicas` lo configura el propietario en Railway).
6. **Claves reales de TanStack Query**: no existe `['diagram', versionId]`. Al reconectar se
   invalidan `detailKeys.all`, `diagramKeys.version(versionId)`, `diagramKeys.list(projectId)`
   y `projectKeys.detail(projectId)`. Los eventos de detalles **se aplican con su payload**
   (`setQueryData` en `detailKeys.activity(diagramId, key)` y en el `voteCount`) en lugar de
   invalidar y volver a pedir: con ~185 ms de ida y vuelta a staging (T052), entrega más
   petición rozaría los 500 ms de SC-001. La cobertura sí se invalida, en segundo plano.
   Idempotencia: `detail.updated` con `rev` ≤ el de la caché se ignora; `vote.changed` trae el
   `voteCount` absoluto.
7. **Permisos en la caché**: los eventos no traen `permissions` ni `votedByMe` (004, R10). Al
   aplicar `detail.created`/`detail.updated`, el cliente conserva los de la caché o, si el
   detalle es nuevo, los calcula con la misma regla que `detailPermissions` (se mueve a
   `packages/shared` para compartirla) a partir del usuario y del estado del proyecto.
8. **Cierre del proyecto y revocación**: `project:closed` invalida `projectKeys.detail`; la web
   ya deriva el modo de solo lectura de `project.status` (004, `projectOpen`). Cerrar sesión no
   se propaga por el socket: el access token dura 15 min y, al caducar sin renovarse, el socket
   se desconecta.
9. **Espacio de trabajo**: `RealtimeWorkspace` envuelve `DetailsWorkspacePage` (004) como esta
   envuelve `WorkspacePage` (003). Presencia con `overlays.presence` del store de la 003 y la
   selección con `useWorkspaceEvents`; los cursores, en coordenadas de imagen, en una capa HTML
   sobre el canvas (prop `overlay` de `WorkspacePage`) colocada con `imageToScreen` y movida con
   `requestAnimationFrame` sin renderizar React: el canvas usa `frameloop="demand"` y un `Html`
   de drei obligaría a redibujar la escena en cada fotograma de interpolación. Con 50 cursores hay que mantener ≥ 50 FPS con `cien-actividades.png`
   (`pnpm e2e:perf`).
10. **Rate limit por socket en memoria** (cursores 20/s, selección 10/s): cada socket vive en
    una réplica, así que no hace falta Redis; distinto del límite HTTP de 60 escrituras por
    minuto y usuario de la 004, que no cambia.
11. **Borradores**: el formulario de la 004 (`DetailForm`) guarda en `localStorage` por diagrama
    y `activityKey`, con `try/catch`, y lo borra al guardar.
12. **Pruebas**: servidor real con `app.listen({ port: 0 })` y `socket.io-client`; E2E en
    `e2e/flows/` con dos contextos y los helpers de la 004 (`registerTeam`,
    `projectWithPublishedDiagram`); la carga de 50 usuarios con un script de `socket.io-client`
    en `e2e/perf` en lugar de Artillery (sin dependencia nueva; Principio VII), y medición en
    staging como en T052.

## Mediciones (T042, 2026-10-01)

En local (Docker Compose con una réplica de `api`, Apple M1, Chrome de Playwright con ventana),
con `pnpm e2e --project perf -g realtime`:

| Medida | Objetivo | Resultado |
|--------|----------|-----------|
| `recepción − at` de `detail.created` con 50 clientes en el diagrama, cursores a 20 Hz y un detalle cada 30 s durante 2 min (200 recepciones) | p95 < 500 ms (SC-001) | p50 41 ms, p95 58 ms, máx. 58 ms |
| Desconexiones durante la prueba | 0 (SC-002) | 0 |
| Cada cliente recibe cada evento de detalle (conteo por `eventId`) | exactamente una vez (SC-004) | 4 de 4 en los 50 clientes, sin duplicados |
| FPS con 50 cursores moviéndose sobre `cien-actividades.png` | ≥ 50 (ajuste 9) | 60 FPS al hacer zoom y al desplazar (p95 de 17 ms) |

- Los relojes coinciden porque cliente y servidor están en el mismo host; en staging la medida
  de extremo a extremo se repite a mano (T046).
- Con 60 FPS, la capa HTML de cursores no necesita pasar a sprites de three.js.

## Complexity Tracking

Sin violaciones.
