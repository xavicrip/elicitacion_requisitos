---
description: "Task list for feature 005-colaboracion-tiempo-real"
---

# Tasks: Colaboración en tiempo real

**Input**: Design documents from `/specs/005-colaboracion-tiempo-real/`
**Prerequisites**: plan.md (incluidos los "Ajustes tras implementar la 002, la 003 y la 004"),
spec.md, research.md, data-model.md, contracts/socket-events.md, quickstart.md

**Tests**: OBLIGATORIAS (Principio III). Cada par prueba + implementación va en el mismo commit.
Las pruebas de `api` levantan un servidor real (`app.listen({ port: 0 })`) con MongoDB y Redis
reales (`pnpm test:services:up`) y se conectan con `socket.io-client`; el reparto entre réplicas
se prueba con dos instancias de `buildTestApp` sobre el mismo Redis (plan, ajuste 5). Los
tiempos de presencia y de caducidad del token se inyectan por opciones para que las pruebas no
esperen 10 s ni 60 s. Los E2E siguen el patrón de la 004 (`e2e/flows/`, helpers de
`flows/details.ts`, `__canvasState` solo con `E2E_HOOKS`) con varios contextos de navegador.

**Commits**: Conventional Commits, un commit atómico por tarea o par; el tipo y alcance
sugeridos van al final de cada tarea.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia de usuario (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependencias, documentos al día con los ajustes del plan y helpers de E2E

- [X] T001 Añadir `socket.io` y `@socket.io/redis-adapter` a `apps/api/package.json`, `socket.io-client` a `apps/web/package.json` (importado solo desde el chunk del espacio de trabajo, cargado en diferido: el bundle inicial no crece) y como `devDependency` de `apps/api` y de `e2e` para las pruebas — `chore(repo)`
- [X] T002 [P] Alinear el Technical Context y la Constitution Check de `plan.md` (dos instancias de la app en lugar de Compose, script de `socket.io-client` en lugar de Artillery, réplicas configuradas en Railway por el propietario y no en `railway.json`, membresía verificada al unirse y en cada evento de cliente), `research.md` (R3 y R4: claves reales de TanStack Query y aplicar los payloads en lugar de invalidar; R7: los eventos de proyecto y miembros los añade esta feature, no existen en la 002; R8: script de `socket.io-client` en lugar de Artillery y sin job `load.yml`), `data-model.md` (borrador por `diagramId` y `activityKey`, ajuste 11) y `quickstart.md` (dos instancias en lugar de `--scale api=2`; flag `realtime`; comandos de prueba reales) con los ajustes 1–12 del plan — `docs(specs)`
- [X] T003 [P] Helpers de E2E en `e2e/flows/realtime.ts`: abrir el mismo diagrama en varios contextos de navegador con cuentas distintas (reutiliza `registerTeam`, `projectWithPublishedDiagram` y `selectActivity` de `flows/details.ts`), esperar a estar conectado (barra de presencia visible) y crear detalles por la API desde otra cuenta — `test(e2e)`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquemas compartidos, flag, eventos de dominio de proyecto y diagrama, servidor
Socket.IO con autenticación y salas, proxy y cliente

**⚠️ CRITICAL**: ninguna historia puede empezar hasta completar esta fase

- [X] T004 [P] Pruebas de `packages/shared/src/realtime.ts` en `packages/shared/tests/realtime.test.ts`: esquemas zod de `room:join`, `room:leave`, `presence:heartbeat`, `presence:select` (`activityKey` string o `null`), `cursor:move` (`x` e `y` finitos y ≥ 0) y `auth:refresh`; `PresenceEntry`; los nombres de eventos servidor → cliente de `contracts/socket-events.md`; `presenceColor(userId)` estable sobre una paleta de 12 colores con contraste AA sobre blanco — `test(shared)`
- [X] T005 Implementar `packages/shared/src/realtime.ts` (tipos `ServerToClientEvents`/`ClientToServerEvents` para tipar `Server` y `Socket`, esquemas y paleta) y exportarlo desde `packages/shared/src/index.ts` — `feat(shared)`
- [X] T006 [P] Pruebas del flag `realtime` (desactivado por defecto, plan ajuste 2) en `apps/api/tests/integration/realtime-flag.test.ts`: sin el flag, `/socket.io/` no responde a un *handshake* WebSocket (no se monta el servidor) y `GET /config` lo informa; con `realtime=true`, sí — `test(api)`
- [X] T007 Implementar el flag `realtime` en `packages/shared/src/flags.ts` (`owner: 005-colaboracion-tiempo-real`), `docs/feature-flags.md` y `FEATURE_FLAGS=realtime=true` por defecto en `infra/docker-compose.yml` y en el job `e2e-smoke` de `.github/workflows/ci.yml` — `feat(shared)`
- [X] T008 [P] Pruebas del bus de eventos generalizado (plan, ajuste 4) en `apps/api/tests/unit/domain-events.test.ts` (sustituye a `detail-events.test.ts`: emisor tipado con los eventos de la 004 más `diagram.published`, `project.status_changed`, `member.removed`, `member.left` y `project.deleted`; sin `permissions` ni `votedByMe`; un suscriptor que falla no interrumpe a los demás; la auditoría sigue registrando solo los eventos de detalles) y en `apps/api/tests/integration/domain-events.test.ts` (publicar una versión, cambiar el estado del proyecto, retirar o salir un miembro y borrar el proyecto emiten su evento después de confirmar la escritura, y no lo emiten si la escritura falla) — `test(api)`
- [X] T009 Generalizar `apps/api/src/modules/details/events.ts` a `apps/api/src/lib/domain-events.ts` (decorado como `app.domainEvents`; los servicios de detalles, votos y comentarios pasan a usarlo sin cambiar su comportamiento), ampliar los tipos en `packages/shared/src/events.ts` y emitir los eventos nuevos desde `apps/api/src/modules/diagrams/service.ts`, `apps/api/src/modules/projects/service.ts` y `apps/api/src/modules/projects/members.ts` — `feat(api)`
- [X] T010 [P] Pruebas de autenticación y salas en `apps/api/tests/integration/realtime-auth.test.ts`: *handshake* sin token, con token inválido o caducado → `connect_error` `unauthorized`; solo `transports: ['websocket']` (el *polling* se rechaza); `room:join` de una versión de un proyecto del que no es miembro, o de un borrador para un Participante → `{ ok: false, code: 'not_found' }`; un miembro → `{ ok: true, presence }` y queda en `project:{id}`, `diagram:{versionId}` y `user:{id}`; un payload inválido se descarta y se registra en el log; `auth:refresh` con un token válido renueva la identidad; sin renovar, el socket se desconecta al pasar el margen tras la caducidad (60 s en producción, inyectable en la prueba) — `test(api)`
- [X] T011 Implementar `apps/api/src/realtime/{server.ts,rooms.ts,rate-limit.ts}`: plugin que monta Socket.IO sobre el servidor de Fastify solo con el flag `realtime`, con `@socket.io/redis-adapter` (dos conexiones `duplicate()` del Redis de la 002) y el middleware de JWT (`app.jwt.verify`); `room:join` comprueba la membresía y la visibilidad de la versión con las mismas reglas que los guards REST de la 003; rate limit en memoria por socket y evento; registrado en `apps/api/src/app.ts` — `feat(api)`
- [X] T012 [P] Prueba del proxy en `e2e/smoke.spec.ts` (solo lectura, también contra staging y producción): con `realtime` activado según `/api/config`, un `socket.io-client` sin token conectado a `BASE_URL` por `/socket.io/` recibe `connect_error` `unauthorized` (el WebSocket atraviesa `web` hasta `api`); con el flag desactivado, la prueba se salta — `test(e2e)`
- [X] T013 Añadir `handle /socket.io/*` con `reverse_proxy {$API_INTERNAL_URL}` y `X-Real-IP` en `apps/web/Caddyfile` (con `handle`, no `handle_path`) y `'/socket.io': { target, ws: true }` en `apps/web/vite.config.ts` (plan, ajuste 3) — `feat(web)`
- [X] T014 [P] Pruebas del cliente en `apps/web/tests/realtime-socket.test.ts` (con `socket.io-client` simulado): un único socket por pestaña, solo WebSocket, con el access token de `auth-store`; ante `unauthorized`, refresca con `refreshSession` y reintenta una vez; cuando el token se renueva envía `auth:refresh`; reconexión con espera de 0,5 a 5 s; el estado de la conexión (`connecting`, `connected`, `disconnected`) se expone en un store; sin el flag `realtime` no se crea el socket — `test(web)`
- [X] T015 Implementar `apps/web/src/features/realtime/socket.ts` y el store de conexión `apps/web/src/features/realtime/connection.ts` — `feat(web)`

**Checkpoint**: fundaciones listas; `pnpm test`, `pnpm e2e` y el despliegue siguen en verde con el flag desactivado

---

## Phase 3: User Story 1 - Ver los aportes de los demás al instante (Priority: P1) 🎯 MVP

**Goal**: detalles, votos, comentarios, cambios de estado y publicaciones llegan a los demás
miembros conectados al proyecto en menos de 1 s, sin recargar, y solo a ellos

**Independent Test**: quickstart.md §1

### Tests for User Story 1 ⚠️

- [X] T016 [P] [US1] Pruebas de contrato de **todos** los eventos de `contracts/socket-events.md` (Principio III) en `apps/api/tests/contract/socket-events.contract.test.ts`, empezando por los de esta historia: los 9 de detalles y `diagram.published` validan contra los esquemas de `packages/shared` y llevan `eventId` (UUID) y `at`; `room:join` y `auth:refresh` con un payload inválido responden con un ack de error. US2, US4 y US3 amplían este archivo con sus eventos (T024, T029 y T036) — `test(api)`
- [X] T017 [P] [US1] Pruebas de integración en `apps/api/tests/integration/realtime-sync.test.ts`: dos miembros del proyecto A conectados y uno del proyecto B; crear, editar, borrar, moderar y reasignar un detalle, votar y comentar por REST hace llegar el evento a los dos de A (también al autor) y nunca al de B (US1 escenario 4, FR-002); publicar una versión emite `diagram.published`; un socket que no ha hecho `room:join` no recibe nada; con dos instancias de la app sobre el mismo Redis, la escritura en una llega a un cliente conectado a la otra (FR-009) — `test(api)`
- [X] T018 [P] [US1] Pruebas de `detailPermissions` movida a `packages/shared` (plan, ajuste 7) en `packages/shared/tests/detail-permissions.test.ts`, con los mismos casos que la regla de `api` (autor, Administrador, estado del detalle y del proyecto); la prueba de `api` sigue en verde importándola de `@reqcanvas/shared` — `test(shared)`
- [X] T019 [P] [US1] Pruebas de `useRealtimeSync` en `apps/web/tests/realtime-sync.test.tsx`: `detail.created` añade el detalle a `detailKeys.activity(diagramId, key)` con permisos calculados para el usuario actual; `detail.updated` con `rev` ≤ el de la caché se ignora y con `rev` mayor sustituye conservando `permissions` y `votedByMe`; `detail.deleted` y `detail.status_changed`; `vote.changed` fija el `voteCount` absoluto y solo cambia `votedByMe` si `userId` es el actual; `comment.*` actualiza `commentCount` y la lista de comentarios abierta; la cobertura se invalida; `diagram.published` invalida `diagramKeys.version` y `diagramKeys.list`; recibir el propio evento no duplica nada; si llega `detail.updated` con el formulario de edición de ese detalle abierto, el formulario conserva lo escrito y, al guardar, el `If-Match` con el `rev` con que se abrió da `409` y aparece el `ConflictDialog` de la 004 (edge case de la spec); al cambiar la versión mostrada (tras `diagram.published`), el socket hace `room:leave` de la anterior y `room:join` de la nueva — `test(web)`
- [X] T020 [P] [US1] E2E en `e2e/flows/realtime-sync.spec.ts`: Ana y Luis con el mismo diagrama abierto; Luis registra un detalle en "Validar pago" y Ana ve el contador +1 y el detalle en su panel en < 1 s sin recargar; Ana vota y valida y Luis ve el voto y el estado; Marta, conectada a otro proyecto, no recibe nada — `test(e2e)`

### Implementation for User Story 1

- [X] T021 [US1] Mover `detailPermissions` a `packages/shared/src/details.ts` (y usarla desde `apps/api/src/modules/details/permissions.ts`) — `refactor(shared)`
- [X] T022 [US1] Implementar `apps/api/src/realtime/bridge.ts`: suscripción `onAny` a `app.domainEvents` y `io.to('project:{id}').emit` con `eventId` y `at`; `diagram.published` también a `diagram:{versionId}` — `feat(api)`
- [X] T023 [US1] Implementar `apps/web/src/features/realtime/{useRealtimeSync.ts,RealtimeWorkspace.tsx}`: `RealtimeWorkspace` envuelve `DetailsWorkspacePage` en la ruta `/proyectos/:projectId/diagramas/:diagramId` (sin el flag, `DetailsWorkspacePage` como en la 004), hace `room:join` de la versión mostrada (y cambia de sala cuando cambia la versión) y aplica los eventos sobre la caché (plan, ajustes 6 y 9); el formulario de edición de la 004 parte del `rev` y los valores con que se abrió, no de la caché actualizada — `feat(web)`

**Checkpoint**: US1 funcional; quickstart §1 en verde

---

## Phase 4: User Story 2 - Presencia: quién está conectado (Priority: P2)

**Goal**: lista de personas conectadas al diagrama con nombre y color, y la actividad que tiene
seleccionada cada una

**Independent Test**: quickstart.md §2

### Tests for User Story 2 ⚠️

- [X] T024 [P] [US2] Pruebas de integración en `apps/api/tests/integration/presence.test.ts`: `room:join` devuelve el estado y emite `presence:update` completo a `diagram:{versionId}`; dos pestañas del mismo usuario cuentan como una (`sockets: 2`) y desaparece al cerrar la última; `presence:heartbeat` actualiza `lastSeen` y el barrido elimina a quien no da señal en 10 s (tiempos inyectados), con un solo barrido a la vez entre instancias (`SET NX`); `presence:select` se reparte y se limita a 10/s; el color es `presenceColor(userId)`; como mucho 50 entradas; la clave expira si nadie la actualiza; con dos instancias, la presencia es la misma en ambas; `presence:select` y `presence:heartbeat` de un socket que no está en la sala se ignoran. Amplía `socket-events.contract.test.ts` con `presence:update` y los payloads inválidos de `presence:*` — `test(api)`
- [X] T025 [P] [US2] Pruebas en `apps/web/tests/presence.test.tsx`: `PresenceBar` lista a los demás con nombre y color (sin duplicados y sin el usuario actual); seleccionar una actividad envía `presence:select` (con `useWorkspaceEvents` de la 003); la actividad seleccionada por otra persona muestra su color, combinado con los indicadores de cobertura de la 004 sin taparlos; latido cada 5 s mientras la pestaña está abierta — `test(web)`
- [X] T026 [P] [US2] E2E en `e2e/flows/presence.spec.ts`: tres cuentas ven a las otras dos; Luis selecciona "Emitir factura" y los demás ven su color en esa actividad; Luis abre otra pestaña y sigue apareciendo una vez; al cerrar ambas, desaparece en ≤ 10 s — `test(e2e)`

### Implementation for User Story 2

- [X] T027 [US2] Implementar `apps/api/src/realtime/presence.ts` (hash `presence:{versionId}`, latido, barrido con bloqueo, selección) y conectarlo en `rooms.ts` y en la desconexión — `feat(api)`
- [X] T028 [US2] Implementar `apps/web/src/features/realtime/{usePresence.ts,PresenceBar.tsx}` y el indicador de selección con `overlays.presence` del store de la 003; `DetailsWorkspacePage` acepta indicadores adicionales para componerlos con los suyos — `feat(web)`

**Checkpoint**: US2 funcional; quickstart §2 en verde

---

## Phase 5: User Story 4 - Reconexión sin pérdida (Priority: P2)

**Goal**: aviso de desconexión, reintento automático, resincronización al volver sin perder el
borrador, y revocación inmediata al retirar a un miembro o cerrar el proyecto

**Independent Test**: quickstart.md §4

### Tests for User Story 4 ⚠️

- [X] T029 [P] [US4] Pruebas de integración en `apps/api/tests/integration/revocation.test.ts`: retirar a un miembro o que salga hace que sus sockets dejen `project:{id}` y `diagram:*` de ese proyecto y reciban `access:revoked` con `reason: 'removed'`, sin afectar a los demás; borrar el proyecto → `access:revoked` con `reason: 'deleted'` a todos; cerrar o reabrir → `project:closed` / `project:reopened` a la sala; un socket revocado no puede volver a unirse. Amplía `socket-events.contract.test.ts` con `access:revoked`, `project:closed` y `project:reopened` — `test(api)`
- [X] T030 [P] [US4] Pruebas en `apps/web/tests/reconnect.test.tsx`: al desconectarse, `ConnectionBanner` muestra "Sin conexión: reintentando" y guardar, votar y comentar se deshabilitan; al reconectar, vuelve a hacer `room:join` e invalida `detailKeys.all`, `diagramKeys.version`, `diagramKeys.list` y `projectKeys.detail`; `access:revoked` muestra "Ya no tienes acceso a este proyecto" y lleva a "Mis proyectos"; `project:closed` deja el panel en solo lectura sin recargar; reconectar después de que el barrido haya quitado a la persona de la presencia (tiempos inyectados) la vuelve a mostrar y resincroniza (SC-003) — `test(web)`
- [X] T031 [P] [US4] Pruebas de `drafts.ts` y del formulario de la 004 en `apps/web/tests/drafts.test.tsx`: el formulario guarda el borrador en `localStorage` (`draft:{diagramId}:{activityKey}`, y el `detailId` y `rev` al editar) con debounce de 300 ms, lo restaura al volver a abrir la actividad o al recargar, lo borra al guardar con éxito, ignora los de más de 7 días y funciona si `localStorage` lanza (navegación privada) — `test(web)`
- [X] T032 [P] [US4] E2E en `e2e/flows/reconnect.spec.ts`: Luis sin red (`context.setOffline(true)`) ve el aviso y guardar deshabilitado y escribe un borrador; Ana crea 2 detalles; Luis vuelve a tener red y ve los 2 detalles y su borrador intacto (SC-003); Ana retira a Luis y Luis ve "Ya no tienes acceso" al instante; Ana cierra el proyecto y Marta pasa a solo lectura sin recargar (FR-008) — `test(e2e)`

### Implementation for User Story 4

- [X] T033 [US4] Implementar `apps/api/src/realtime/revocation.ts` (suscripción a `member.removed`, `member.left`, `project.status_changed` y `project.deleted` de `app.domainEvents`; cerrar sesión no se propaga por el socket, plan ajuste 8) — `feat(api)`
- [X] T034 [US4] Implementar `apps/web/src/features/realtime/ConnectionBanner.tsx`, la resincronización al reconectar y el manejo de `access:revoked` y `project:closed` en `RealtimeWorkspace.tsx`; los botones de guardar, votar y comentar de la 004 se deshabilitan sin conexión — `feat(web)`
- [X] T035 [US4] Implementar `apps/web/src/features/realtime/drafts.ts` y usarlo en `apps/web/src/features/details/DetailForm.tsx` (plan, ajuste 11) — `feat(web)`

**Checkpoint**: US4 funcional; quickstart §4 en verde

---

## Phase 6: User Story 3 - Cursores en vivo (Priority: P3)

**Goal**: cada persona ve los cursores de los demás sobre el diagrama, en coordenadas de
imagen, con su nombre, y puede ocultarlos

**Independent Test**: quickstart.md §3

### Tests for User Story 3 ⚠️

- [X] T036 [P] [US3] Pruebas de integración en `apps/api/tests/integration/cursors.test.ts`: `cursor:move` se reparte a `diagram:{versionId}` sin el emisor y como evento volátil; más de 20 por segundo se descartan (y se cuentan en el log); coordenadas inválidas se descartan; un socket que no está en la sala no puede emitir en ella. Amplía `socket-events.contract.test.ts` con `cursor:moved` y los payloads inválidos de `cursor:move` — `test(api)`
- [X] T037 [P] [US3] Pruebas de `CursorsLayer` en `apps/web/tests/cursors.test.tsx`: un cursor en coordenadas de imagen queda sobre el mismo punto con cámaras distintas; el envío se limita a uno cada 50 ms; el movimiento se interpola; un cursor sin novedades en 5 s se oculta; "Ocultar cursores" se guarda en `localStorage` (con `try/catch`) y oculta los ajenos — `test(web)`
- [X] T038 [P] [US3] E2E en `e2e/flows/cursors.spec.ts`: Ana con zoom al 200 % y Luis al 50 % (con `__canvasState`); el cursor de Luis sobre "Validar pago" aparece en la pantalla de Ana sobre esa misma actividad; Ana activa "Ocultar cursores" y deja de verlo — `test(e2e)`

### Implementation for User Story 3

- [X] T039 [US3] Implementar `apps/api/src/realtime/cursors.ts` — `feat(api)`
- [X] T040 [US3] Implementar `apps/web/src/features/realtime/CursorsLayer.tsx` (capa HTML en coordenadas de imagen sobre el canvas, plan ajuste 9) y la preferencia "Ocultar cursores" — `feat(web)`

**Checkpoint**: US3 funcional; quickstart §3 en verde

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T041 [P] Observabilidad (Principio VI) en `apps/api/src/realtime/server.ts` con su prueba en `apps/api/tests/integration/realtime-observability.test.ts`: log de conexiones y desconexiones por réplica (sin tokens), latencia del *ping* y eventos descartados por rate limit o payload inválido — `feat(api)`
- [X] T042 [P] Mediciones en `e2e/perf/realtime.perf.spec.ts` (plan, ajuste 12): 50 clientes de `socket.io-client` en el mismo diagrama, con cursores a 20 Hz y un detalle cada 30 s durante 2 min; p95 de `recepción − at` < 500 ms (SC-001) sin desconexiones (SC-002), cada cliente recibe cada evento de detalle exactamente una vez (conteo por `eventId`, SC-004), y ≥ 50 FPS con 50 cursores y `cien-actividades.png` (ajuste 9); anotarlo en `plan.md` — `perf(e2e)`
- [X] T043 [P] ADR `docs/adr/0007-colaboracion-en-tiempo-real.md` (solo WebSocket por la falta de sesiones persistentes en Railway, adaptador Redis en lugar de publicar los eventos aparte, aplicar los payloads en lugar de volver a pedir, resincronizar invalidando en lugar de reenviar eventos perdidos, presencia en Redis con barrido) — `docs(adr)`
- [X] T044 [P] Actualizar el README (sección de colaboración en tiempo real: presencia, cursores, aviso de conexión, flag `realtime`) y revisar que `quickstart.md` siga al día con lo construido — `docs(repo)`
- [ ] T045 Configurar Railway **antes de fusionar**: `FEATURE_FLAGS=realtime=true` en `api` de staging (producción sin cambios) y 2 réplicas de `api` en staging para validar el reparto (plan, ajuste 5); registrarlo en `docs/adr/0002-despliegue-railway.md` — `docs(infra)`
- [ ] T046 Recorrer quickstart.md en staging (§1–§4) con un Administrador y dos Participantes, comprobar que el borde de Railway mantiene el WebSocket abierto (ajuste 3) y que con 2 réplicas los eventos llegan entre ellas, y medir la latencia de extremo a extremo; registrar el resultado en `quickstart.md` — `docs(repo)`
- [ ] T047 Activar `realtime` por defecto (`default: true`) cuando las cuatro historias y T046 estén en verde; retirar el flag en un commit posterior y separado (constitución IV) — `feat(shared)`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → historias.
- **US1**: tras la Phase 2. Aporta `RealtimeWorkspace` y `useRealtimeSync`, que usan las demás.
- **US2**: tras US1 (se monta en `RealtimeWorkspace`).
- **US4**: tras US1 (resincroniza lo que sincroniza US1); independiente de US2.
- **US3**: tras US2 (comparte la sala del diagrama y la composición de capas sobre el canvas).
- **Polish**: al final; T045 antes de fusionar a `main`. T047 es la última tarea.

### Within Each User Story

- Pruebas (en rojo) → implementación (en verde) → refactor; cada par se integra en un commit.
- `api` (realtime) → `web` → E2E en verde.

### Parallel Opportunities

- Phase 1: T002 y T003 en paralelo con T001.
- Phase 2: los pares T004–T005, T006–T007, T008–T009 y T012–T013 son independientes entre sí; T010–T011 tras T005 y T009; T014–T015 tras T005.
- Tras US1: US2 y US4 pueden avanzar en paralelo (archivos distintos salvo `RealtimeWorkspace.tsx`, que se coordina por orden de commit).
- Cada historia: todas sus pruebas [P] a la vez. `socket-events.contract.test.ts` (T016) lo amplían T024, T029 y T036 en su historia.

## Parallel Example: User Story 1

```bash
# Pruebas en paralelo (deben fallar):
Task: "Contrato en apps/api/tests/contract/socket-events.contract.test.ts"
Task: "Reparto y aislamiento en apps/api/tests/integration/realtime-sync.test.ts"
Task: "Permisos compartidos en packages/shared/tests/detail-permissions.test.ts"
Task: "Caché en apps/web/tests/realtime-sync.test.tsx"
Task: "E2E en e2e/flows/realtime-sync.spec.ts"
```

## Implementation Strategy

### MVP First

1. Phases 1 y 2 → 2. US1 → **validar con quickstart §1** (un detalle registrado en un navegador
   aparece en el otro en menos de 1 s, y no en otro proyecto).

### Incremental Delivery

US2 → US4 → US3, cada una integrable en `main` detrás del flag `realtime` y desplegable en
staging (con `realtime=true` solo allí). Producción recibe el código en cada release, pero la
funcionalidad solo se activa con T047.

## Notes

- Tareas totales: 47 (Setup 3, Foundational 12, US1 8, US2 5, US4 7, US3 5, Polish 7).
- Nunca integrar un commit que rompa `pnpm test` (Principio IV).
- T045 requiere acceso a Railway y lo hace el propietario del proyecto; T046 usa staging.
- La escritura sigue siendo solo por REST: el socket notifica y nunca modifica datos
  (research R3). La edición simultánea del mismo detalle usa el control de conflictos de la 004.
- Cambios tras `/speckit-analyze`: C1 → T016, T024, T029, T036; U1 → T019, T023; U2 → plan
  ajuste 8, T029, T033; U3 → T019, T023; G1 → T042; I1 → T002; G2 → T030; S1 → T024; T1 →
  contrato.
