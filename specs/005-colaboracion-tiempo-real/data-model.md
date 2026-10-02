# Data Model: Colaboración en tiempo real

**Feature**: 005-colaboracion-tiempo-real | **Date**: 2026-09-25

No hay colecciones nuevas en MongoDB. Estructuras en Redis y en el cliente:

## Sesión de presencia (Redis)

- **Clave**: `presence:{versionId}` (hash). **Campo**: `{userId}:{socketId}`, uno por socket:
  varias pestañas o réplicas no compiten por un contador; la presencia se agrupa por persona
  al leerla (`presenceState`).
- **Valor** (JSON):

| Campo | Tipo | Reglas |
|-------|------|--------|
| `userId` | string | Persona del socket |
| `name` | string | Nombre del usuario |
| `selectedActivityKey` | string \| null | Actividad seleccionada |
| `selectedAt` | number | epoch ms de la selección; con varias pestañas manda la última |
| `lastSeen` | number | epoch ms; no cuenta si `now - lastSeen > 10 000` y el barrido lo elimina |

- El color no se guarda: es `presenceColor(userId)`, estable sobre la paleta de 12 colores.
- Al cerrar el socket o salir de la sala se borra su campo.
- **Barrido**: cada 5 s, bloqueo `presence:sweep:lock` (`SET NX PX`), una réplica cada vez.
- La clave expira (`PEXPIRE 3600000`) si nadie la actualiza.

## Canal del adaptador (Redis pub/sub)

Gestionado por `@socket.io/redis-adapter` (prefijo `socket.io#`). Sin datos persistentes.

## Salas de Socket.IO

| Sala | Miembros | Uso |
|------|----------|-----|
| `project:{projectId}` | Sockets de miembros del proyecto | Eventos de dominio (detalles, votos, comentarios, estado del proyecto) |
| `diagram:{versionId}` | Sockets que ven ese diagrama | Presencia, cursores, `diagram.published` |
| `user:{userId}` | Todos los sockets de un usuario | Revocación y notificaciones personales (`export:ready` en la 008) |

## Borrador local (cliente, `localStorage`)

- **Clave**: `draft:{diagramId}:{activityKey}` (la `activityKey` se conserva entre versiones). **Valor**: `{given, when, then, type, priority,
  authorRole, tags, detailId?, rev?, savedAt}`.
- Se elimina al guardar con éxito. Se ignora si tiene más de 7 días. Todo acceso está envuelto
  en `try/catch` (navegación privada).

## Evento de colaboración

Definido en [contracts/socket-events.md](./contracts/socket-events.md); reutiliza los payloads
de `specs/004-detalles-requisitos/contracts/domain-events.md`.
