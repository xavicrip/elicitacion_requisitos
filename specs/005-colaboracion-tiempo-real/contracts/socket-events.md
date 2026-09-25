# Contrato: eventos de Socket.IO

- **Endpoint**: `wss://<web>/socket.io/` (proxy a `api`), `transports: ['websocket']`.
- **Handshake**: `auth: { token: <accessToken> }`. Error `unauthorized` → el cliente refresca
  el token y reintenta una vez.
- Todos los payloads del cliente se validan con zod (`packages/shared/src/realtime.ts`); un
  payload inválido se descarta y se registra.

## Cliente → servidor

| Evento | Payload | Ack | Reglas |
|--------|---------|-----|--------|
| `room:join` | `{ versionId }` | `{ ok: true, presence: PresenceEntry[] } \| { ok: false, code: 'not_found' }` | Verifica la membresía; une a `project:*`, `diagram:*` y `user:*` |
| `room:leave` | `{ versionId }` | — | |
| `presence:heartbeat` | `{ versionId }` | — | Cada 5 s |
| `presence:select` | `{ versionId, activityKey: string \| null }` | — | Máx. 10/s |
| `cursor:move` | `{ versionId, x: number, y: number }` | — | Coordenadas de imagen (px); máx. 20/s; se descartan los excesos |
| `auth:refresh` | `{ token }` | `{ ok: boolean }` | Renueva la identidad del socket |

## Servidor → cliente

| Evento | Sala | Payload |
|--------|------|---------|
| `detail.created`, `detail.updated`, `detail.deleted`, `detail.status_changed`, `detail.reassigned`, `vote.changed`, `comment.created`, `comment.updated`, `comment.deleted` | `project:{id}` | Los de `004/contracts/domain-events.md` + `eventId` (UUID) |
| `diagram.published` | `project:{id}` | `{ diagramId, versionId }` |
| `project:closed` / `project:reopened` | `project:{id}` | `{ projectId }` |
| `access:revoked` | `user:{id}` | `{ projectId, reason: 'removed' \| 'deleted' }` |
| `presence:update` | `diagram:{v}` | `{ entries: PresenceEntry[] }` (estado completo; ≤ 50 entradas) |
| `cursor:moved` | `diagram:{v}` (volátil, excluye al emisor) | `{ userId, x, y }` |

```ts
type PresenceEntry = {
  userId: string; name: string; color: string;
  selectedActivityKey: string | null;
};
```

## Comportamiento del cliente

| Situación | Acción |
|-----------|--------|
| `disconnect` | Mostrar "Sin conexión: reintentando"; deshabilitar guardar; conservar borradores |
| `connect` tras una desconexión | `room:join` + invalidar las consultas `['diagram', versionId]` |
| `access:revoked` | Mensaje "Ya no tienes acceso a este proyecto" y redirigir a "Mis proyectos" |
| `project:closed` | Pasar a solo lectura sin recargar |
| Evento con `rev` ≤ el de la caché | Ignorar (idempotencia) |
