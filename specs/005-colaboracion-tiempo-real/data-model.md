# Data Model: Colaboración en tiempo real

**Feature**: 005-colaboracion-tiempo-real | **Date**: 2026-09-25

No hay colecciones nuevas en MongoDB. Estructuras en Redis y en el cliente:

## Sesión de presencia (Redis)

- **Clave**: `presence:{versionId}` (hash). **Campo**: `userId`.
- **Valor** (JSON):

| Campo | Tipo | Reglas |
|-------|------|--------|
| `name` | string | Nombre del usuario |
| `color` | string | `#RRGGBB` de la paleta de 12 colores, estable por `userId` |
| `sockets` | number | Nº de pestañas conectadas; al llegar a 0 se elimina el campo |
| `selectedActivityKey` | string \| null | Actividad seleccionada |
| `lastSeen` | number | epoch ms; se elimina si `now - lastSeen > 10 000` |

- **Barrido**: cada 5 s, bloqueo `presence:sweep:lock` (`SET NX PX 4000`).
- La clave expira (`EXPIRE 3600`) si nadie la actualiza.

## Canal del adaptador (Redis pub/sub)

Gestionado por `@socket.io/redis-adapter` (prefijo `socket.io#`). Sin datos persistentes.

## Salas de Socket.IO

| Sala | Miembros | Uso |
|------|----------|-----|
| `project:{projectId}` | Sockets de miembros del proyecto | Eventos de dominio (detalles, votos, comentarios, estado del proyecto) |
| `diagram:{versionId}` | Sockets que ven ese diagrama | Presencia, cursores, `diagram.published` |
| `user:{userId}` | Todos los sockets de un usuario | Revocación y notificaciones personales (`export:ready` en la 008) |

## Borrador local (cliente, `localStorage`)

- **Clave**: `draft:{versionId}:{activityKey}`. **Valor**: `{given, when, then, type, priority,
  authorRole, tags, detailId?, rev?, savedAt}`.
- Se elimina al guardar con éxito. Se ignora si tiene más de 7 días. Todo acceso está envuelto
  en `try/catch` (navegación privada).

## Evento de colaboración

Definido en [contracts/socket-events.md](./contracts/socket-events.md); reutiliza los payloads
de `specs/004-detalles-requisitos/contracts/domain-events.md`.
