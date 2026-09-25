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
**Primary Dependencies**: `socket.io` 4, `@socket.io/redis-adapter`, `ioredis`; `socket.io-client` en `web`; Artillery con el motor `socket.io` para las pruebas de carga
**Storage**: Redis (pub/sub del adaptador, presencia `presence:{versionId}`); sin colecciones nuevas en MongoDB
**Testing**: Vitest con servidor Socket.IO real y varios clientes (autorización de salas, fan-out, presencia, revocación); prueba de dos réplicas de `api` con Docker Compose; Playwright con dos contextos de navegador; Artillery (50 usuarios)
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
| V. Seguridad por defecto | Autenticación con el JWT en el *handshake*, pertenencia verificada al unirse a cada sala y en cada evento de cliente, rate limit por socket, validación zod de los payloads. | ✅ |
| VI. Observabilidad | Métricas en log de conexiones por réplica, latencia de *ping* y eventos descartados por rate limit. | ✅ |
| VII. Simplicidad | Resincronizar invalidando las consultas (en lugar de reenviar eventos perdidos); sin CRDT. | ✅ |
| Restricciones (v1.1.0) | Node 24; Socket.IO; el despliegue desde GitHub Actions no cambia (réplicas configuradas en `railway.json`). | ✅ |

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
tests/load/realtime.artillery.yml
e2e/{realtime-sync,presence,reconnect}.spec.ts
```

**Structure Decision**: carpeta `realtime/` en `api` (transversal, no un módulo de dominio);
feature `realtime` en `web`, que se engancha al workspace mediante `useWorkspaceEvents` y
`overlays.presence` (contrato de la 003).

## Complexity Tracking

Sin violaciones.
