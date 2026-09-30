# ADR 0004: Sesión con JWT y refresh rotativo, detrás de un proxy en web

- **Estado**: aceptado
- **Fecha**: 2026-09-30
- **Feature**: 002-auth-proyectos (research R1, R2, R4; plan, ajustes 2–4)

## Contexto

La 002 añade cuentas y sesiones. Railway sirve `web` y `api` en subdominios distintos de
`up.railway.app`, que está en la Public Suffix List: para el navegador son **sitios distintos**,
así que una cookie de `api` sería de terceros y Safari y Firefox la bloquearían.

## Decisión

1. **Sesión** (research R1):
   - Access token JWT HS256 de 15 min (`JWT_ACCESS_TTL`), con `sub` y `sid`, **solo en
     memoria** en `web` y enviado como `Authorization: Bearer`. No lleva roles: la membresía se
     consulta en cada petición, así que retirar a alguien surte efecto de inmediato.
   - Refresh token opaco de 32 bytes en la cookie `rt` (`HttpOnly`, `SameSite=Strict`,
     `Path=/api/auth` y `Secure` salvo en desarrollo), válido 7 días deslizantes. Se rota en cada
     uso y en la base de datos solo se guarda su SHA-256. Reutilizar un token ya rotado revoca
     toda la familia (`sid`), salvo en los 10 s siguientes a la rotación (dos pestañas que
     refrescan a la vez).
2. **Mismo origen** (research R2): Caddy (`web`) reenvía `/api/*` a `api` por la red privada
   (`handle_path` quita el prefijo; destino `API_INTERNAL_URL`). El frontend usa rutas relativas
   `/api` y la cookie funciona con `SameSite=Strict`. `api` conserva su dominio público para
   `/health` y `/version` (despliegue y smoke).
3. **IP del cliente** (research R4): detrás del proxy, `api` vería la IP de `web`. El borde de
   Railway pone la IP del cliente en `X-Real-IP`; Caddy la reenvía (o pone la de quien conecta,
   sin borde) y `api` la usa (`src/lib/client-ip.ts`) para el rate limit (20/min por IP en
   `/auth/*`) y el bloqueo por origen (5 fallos en 15 min, por email y por IP).
4. **E2E separados** (plan, ajuste 4): el smoke (solo lectura) es lo único que corre contra un
   entorno desplegado; los `flows`, que crean cuentas, solo existen si `BASE_URL` es local.
5. **Flag `accounts`** (constitución IV): toda la 002 queda oculta hasta completar sus cuatro
   historias; se activa en staging con `FEATURE_FLAGS` y en producción al final (T067).

## Alternativas descartadas

- **Dominio propio con subdominios `app.` y `api.`**: resuelve el problema de la cookie, pero
  exige comprar y configurar DNS. Se puede adoptar más adelante sin cambiar el código.
- **`SameSite=None`**: bloqueada por la prevención de rastreo de Safari.
- **JWT en `localStorage`**: expuesto a XSS.
- **Sesión de servidor en Redis**: válida, pero el access token sin estado simplifica la
  autenticación de Socket.IO en la 005.

## Consecuencias

- Una sola variable nueva en `web` (`API_INTERNAL_URL`) y cuatro en `api` (`JWT_SECRET`,
  `JWT_ACCESS_TTL`, `REFRESH_TTL_DAYS`, `APP_BASE_URL`). Sin `JWT_SECRET`, `api` no arranca y
  Railway mantiene la versión anterior: hay que definirla **antes** de desplegar la 002.
- La fiabilidad del límite por IP depende de que el borde de Railway **sobrescriba** una
  `X-Real-IP` enviada por el cliente. **Comprobado en staging (T066, 2026-09-30)**: con una
  `X-Real-IP` falsa distinta en cada petición, las 20 primeras dan `401` y la 21.ª `429`; el
  borde la sobrescribe con la IP real, así que el límite no se puede esquivar enviándola.
- Localmente y en CI, sin borde de Railway, Caddy acepta la `X-Real-IP` del cliente: los E2E la
  usan para que cada prueba tenga sus propios contadores.
