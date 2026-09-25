# Data Model: Autenticación, roles y gestión de proyectos

**Feature**: 002-auth-proyectos | **Date**: 2026-09-25 | Todas las colecciones son propiedad de `api`.

## users

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | |
| `name` | string | 1–80 caracteres, sin espacios al inicio ni al final |
| `email` | string | Normalizado a minúsculas; **índice único** |
| `passwordHash` | string | argon2id; nunca se serializa en respuestas ni logs |
| `createdAt`, `updatedAt` | Date | |
| `lastLoginAt` | Date? | |

## projects

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | |
| `name` | string | 1–100 caracteres |
| `description` | string | 0–2 000 caracteres |
| `status` | `draft \| open \| closed \| deleting` | Estado inicial `draft` |
| `ownerId` | ObjectId → users | Creador (informativo) |
| `members` | `[{ userId, role: "admin" \| "participant", joinedAt }]` | ≥ 1 `admin`; `userId` único dentro del array |
| `lastActivityAt` | Date | Se actualiza con cualquier aporte (features 003–005) |
| `createdAt`, `updatedAt` | Date | |

**Índices**: `{ "members.userId": 1, lastActivityAt: -1 }` (Mis proyectos), `{ status: 1 }`.

**Transiciones de estado**:

```text
draft ──open──▶ open ──close──▶ closed ──reopen──▶ open
  └──────────────┴──────────────┴──delete──▶ deleting ──(job)──▶ (borrado)
```

- `open` y `closed` solo por un Administrador. En `closed` no se admiten escrituras de
  contenido (lo verifican las features 004 y 005).

## invitations

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | |
| `projectId` | ObjectId → projects | |
| `tokenHash` | string | SHA-256 del token; **índice único** |
| `createdBy` | ObjectId → users | Administrador |
| `expiresAt` | Date | `createdAt + 7 días`; índice TTL con 30 días de gracia para limpieza |
| `revokedAt` | Date? | |
| `uses` | number | Contador informativo |

**Estado derivado**: `active` si `revokedAt == null && expiresAt > now`; si no, `expired` o `revoked`.

## refresh_tokens

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | |
| `userId` | ObjectId | |
| `sid` | string | Familia de sesión (UUID) |
| `tokenHash` | string | **Índice único** |
| `expiresAt` | Date | **Índice TTL** |
| `rotatedAt` | Date? | Si se presenta un token ya rotado → revocar todo el `sid` |
| `revokedAt` | Date? | |

## audit_logs (compartida por las features 002–008; escritura solo desde `api`)

| Campo | Tipo | Reglas |
|-------|------|--------|
| `_id` | ObjectId | |
| `projectId` | ObjectId? | |
| `actorId` | ObjectId? | Null para eventos anónimos (p. ej., login fallido) |
| `action` | string | p. ej., `project.status_changed`, `member.role_changed`, `invitation.created`, `auth.login_failed` |
| `entity` | `{ type, id }` | |
| `diff` | object? | Valores anterior y nuevo (sin secretos) |
| `at` | Date | **Índice** `{ projectId: 1, at: -1 }` |

## Migración

`20261001000000-auth-projects-indexes.js`: `up` crea los índices anteriores (incluidos los TTL);
`down` los elimina. No hay transformaciones de datos.
