# Research: Autenticación, roles y gestión de proyectos

**Feature**: 002-auth-proyectos | **Date**: 2026-09-25

## R1. Modelo de sesión

- **Decision**: **access token JWT** (HS256, 15 min, claims `sub`, `sid`) guardado **en memoria**
  en `web` y enviado como `Authorization: Bearer`, más un **refresh token** opaco (32 bytes
  aleatorios) en una cookie `rt` (`httpOnly; Secure; SameSite=Strict; Path=/api/auth`), con
  validez de 7 días deslizantes. Se rota en cada `/auth/refresh`; en la base de datos solo se
  guarda su hash SHA-256 (`refresh_tokens`). Si se reutiliza un token ya rotado, se revoca
  toda la familia (`sid`).
- **Rationale**: el access token en memoria no es accesible a XSS persistente y la cookie
  `httpOnly` no es legible desde JavaScript; la rotación con detección de reutilización limita
  el robo de tokens.
- **Alternatives considered**: sesión de servidor en Redis con cookie (válida, pero el access
  token sin estado simplifica la autenticación de Socket.IO en la 005); JWT en `localStorage`
  (expuesto a XSS).

## R2. Mismo origen para web y API (proxy inverso)

- **Decision**: Caddy (`web`) sirve el frontend y hace `reverse_proxy` de `/api/*` y
  `/socket.io/*` hacia `api.railway.internal:${PORT}` (red privada IPv6). El frontend usa
  rutas relativas (`/api/...`). `API_PUBLIC_URL` pasa a ser opcional (solo para los smoke tests).
- **Rationale**: los subdominios `*.up.railway.app` son sitios distintos (el dominio está en la
  Public Suffix List), así que una cookie de la API sería de terceros y Safari/Firefox la
  bloquearían. Con el mismo origen, `SameSite=Strict` funciona y desaparece el CORS.
- **Alternatives considered**: un dominio propio con subdominios `app.` y `api.` (requiere
  comprar y configurar DNS; se puede hacer más adelante sin cambiar el código); `SameSite=None`
  (bloqueada por la prevención de rastreo de Safari).

## R3. Hash de contraseñas y política

- **Decision**: argon2id con `@node-rs/argon2` (memoryCost 19 MiB, timeCost 2, parallelism 1,
  según OWASP). Política: ≥ 10 caracteres y ausencia en la lista de las 10 000 contraseñas más
  comunes (`data/common-passwords.txt`, cargada en un `Set`).
- **Alternatives considered**: bcrypt (límite de 72 bytes, menos resistente a GPU); zxcvbn
  (más pesado; se puede añadir en el frontend como indicador).

## R4. Límite de intentos y bloqueo

- **Decision**: `@fastify/rate-limit` con almacén Redis: 20 peticiones/min por IP en `/auth/*`.
  Bloqueo de cuenta: contador Redis `login:fail:{emailHash}` y `login:fail:{ip}` con TTL de
  15 min; al 5.º fallo se responde `429` con `Retry-After` durante 15 min. Siempre el mismo
  mensaje genérico ("Email o contraseña incorrectos").
- **Rationale**: FR-004; el contador por email y por IP frena tanto la fuerza bruta dirigida
  como el *credential stuffing*.

## R5. Registro sin enumeración de cuentas

- **Decision**: si el email ya existe, `POST /auth/register` responde `409` con el mensaje
  genérico "No se pudo crear la cuenta con esos datos" y el mismo tiempo de respuesta
  (se ejecuta un hash ficticio).
- **Rationale**: escenario 2 de la US1 (no revelar datos). Un registro "silencioso" con
  verificación por email no es posible porque no hay email en la v1.

## R6. Modelo de membresía

- **Decision**: miembros **embebidos** en `projects.members[] {userId, role, joinedAt}` con índice
  multiclave `members.userId`. La regla "≥ 1 Administrador" se aplica con actualizaciones
  condicionales atómicas (el filtro exige que quede otro admin: `$elemMatch` con
  `userId ≠ objetivo`).
- **Rationale**: coincide con prompt.md §6.3; una sola escritura atómica por documento evita
  necesitar transacciones.
- **Alternatives considered**: colección `memberships` (requiere transacciones o una
  compensación para la regla del último admin).

## R7. Autorización

- **Decision**: *guards* de Fastify `requireAuth` y `requireProjectRole(role)`, que cargan el
  proyecto una vez (`request.project`) y responden **404** si el usuario no es miembro y **403**
  si es miembro sin el rol necesario. Una **matriz de autorización** (`contracts/authorization-matrix.md`)
  se prueba de forma exhaustiva con pruebas parametrizadas (rol × endpoint).
- **Rationale**: FR-011, US4 y SC-003 (100 % de accesos no autorizados denegados).

## R8. Invitaciones

- **Decision**: token aleatorio de 32 bytes (base64url) en la URL `/invitacion/{token}`; en la
  base de datos solo su hash SHA-256. Multiuso, `expiresAt = +7 días`, `revokedAt` opcional.
  Aceptar es idempotente (si ya es miembro, no se duplica). El envío por email queda detrás del
  flag `invite-email` (desactivado) hasta disponer de un servicio de correo.
- **Alternatives considered**: invitaciones de un solo uso por email (requieren correo).

## R9. Borrado en cascada

- **Decision**: `DELETE /projects/:id` exige `confirmName` igual al nombre del proyecto, marca el
  proyecto como `status: "deleting"` (deja de ser visible) y encola `project-deletion` en
  BullMQ. El worker (dentro de `api`) borra de forma idempotente las colecciones registradas
  mediante un **registro de manejadores de cascada** (`registerProjectCascade(fn)`), que usarán
  las features 003–008 (diagramas, archivos, detalles, análisis, exportaciones).
- **Rationale**: robusto sin transacciones y extensible sin modificar el módulo de proyectos.

## R10. Frontend

- **Decision**: React Router 7 (modo librería, rutas protegidas con un *loader* que asegura la
  sesión), TanStack Query para los datos del servidor, Zustand para la sesión (access token en
  memoria), react-hook-form + zod (esquemas compartidos de `packages/shared`) y Tailwind CSS 4.
  Al cargar la app se llama a `/api/auth/refresh` para recuperar la sesión. Un interceptor
  reintenta una vez ante un `401`, tras refrescar el token.
- **Rationale**: validación idéntica en cliente y servidor gracias a los esquemas compartidos
  (Principio II). Conservar el texto en edición cuando caduca la sesión (edge case) se cumple
  porque el refresco es transparente y no hay recarga.

## R11. Nuevas variables de entorno

`JWT_SECRET` (≥ 32 bytes, obligatoria), `JWT_ACCESS_TTL` (por defecto `15m`),
`REFRESH_TTL_DAYS` (por defecto `7`), `APP_BASE_URL` (para construir los enlaces de invitación).
Se añaden a `contracts/env-vars.md` de la 001 y a los GitHub Environments / Railway.
