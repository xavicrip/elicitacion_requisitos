# Quickstart: Autenticación, roles y gestión de proyectos

Requiere el entorno de la feature 001: `pnpm dev:up`. Docker Compose ya define las variables
nuevas (`JWT_SECRET` de desarrollo, `APP_BASE_URL`, `API_INTERNAL_URL`) y activa el flag
`accounts`; fuera de Docker, cópialas de `.env.example`. La app se abre en
`http://localhost:5173` y la API responde en `/api` a través del proxy de Caddy.

## 1. Registro, login y logout (US1)

1. Ir a `/registro`, crear la cuenta "Ana" con `ana@example.com` y una contraseña de 12
   caracteres → se muestra "Mis proyectos" vacío (SC-001: < 1 min).
2. Registrar de nuevo `ana@example.com` → mensaje genérico, sin confirmar que existe.
3. Cerrar sesión e intentar 5 veces con una contraseña incorrecta → el 6.º intento responde
   "Demasiados intentos, espera 15 minutos".
4. Recargar la página con la sesión iniciada → la sesión se conserva (refresh por cookie).

## 2. Proyectos (US2)

1. Crear el proyecto "Tienda en línea" → estado *Borrador*, rol *Administrador*.
2. *Abrir* el proyecto → estado *Abierto*; *Cerrar* → *Cerrado*; *Reabrir* → *Abierto*.
3. Eliminar → el diálogo exige escribir "Tienda en línea"; tras confirmar, desaparece de la
   lista.

## 3. Invitaciones y miembros (US3)

1. En un proyecto nuevo, *Miembros → Generar enlace* y copiarlo (SC-002: < 2 min en total).
2. En una ventana privada, abrir el enlace → registrarse como "Luis" → el proyecto aparece
   con rol *Participante*.
3. Revocar el enlace y abrirlo con una tercera cuenta → "Esta invitación ya no es válida".
4. Retirar a Luis → al recargar, Luis ya no ve el proyecto.
5. Como Ana (única admin), intentar degradarse → "El proyecto necesita al menos un
   Administrador".

## 4. Control de acceso (US4)

El access token solo vive en la memoria de la página; para probar la API directamente, obtén
uno iniciando sesión con `curl`:

```bash
TOKEN_LUIS=$(curl -s localhost:5173/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"luis@example.com","password":"<su contraseña>"}' | jq -r .accessToken)
curl -i -X POST localhost:5173/api/projects/<id>/invitations -H "Authorization: Bearer $TOKEN_LUIS"   # 403
curl -i localhost:5173/api/projects/<id-de-otro-proyecto> -H "Authorization: Bearer $TOKEN_LUIS"     # 404
```

## 5. Pruebas automatizadas

```bash
pnpm test:services:up                                              # MongoDB, Redis y S3 de prueba
pnpm --filter @reqcanvas/api exec vitest run authorization.matrix  # matriz completa (SC-003)
pnpm --filter @reqcanvas/api test                                  # todas las pruebas de api
pnpm e2e --project flows                                           # registro, proyectos, invitaciones, acceso
```

Los E2E de `flows` crean cuentas, así que solo se definen contra el stack local (plan, ajuste
4); tras un despliegue solo corre `pnpm e2e --project smoke`.

## Resultado en staging (T066, 2026-09-30)

`v0.2.0-47-g7d076a0`, con `accounts=true` solo en staging. Recorrido de §1–§4 con un script de
Playwright y navegadores independientes (Ana, Luis y una tercera persona), más comprobaciones
por la API:

| Paso | Resultado |
| --- | --- |
| §1.1 Registro → "Mis proyectos" vacío | ✅ 2,6 s (SC-001: < 1 min) |
| §1.2 Email duplicado | ✅ `409` genérico, sin revelar el email |
| §1.3 Bloqueo | ✅ fallos 1–5 → `401`; 6.º → `429` "Demasiados intentos, espera 15 minutos", `Retry-After: 899`; bloqueada, ni la contraseña correcta entra |
| §1.4 Recargar | ✅ sesión conservada; cookie `rt` `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/auth` |
| §2 Proyectos | ✅ Borrador/Administrador → abrir → cerrar → reabrir → eliminar con confirmación; el job borró los proyectos |
| §3.1 Enlace de invitación | ✅ con la URL pública de web, 2,1 s después de crear el proyecto (SC-002: < 2 min) |
| §3.2 Unirse desde el enlace | ✅ Luis se registra y entra como Participante |
| §3.3 Enlace revocado | ✅ "Esta invitación ya no es válida" |
| §3.4 Retirar a Luis | ✅ al recargar ve "Proyecto no encontrado" |
| §3.5 Última Administradora | ✅ no puede degradarse |
| §4 Control de acceso | ✅ Participante crea invitación → `403`; proyecto ajeno → `404` |

**`X-Real-IP`** (research R4, ADR 0004): 25 peticiones a `/auth/refresh`, cada una con una
`X-Real-IP` falsa distinta, dan `401` hasta la 20.ª y `429` desde la 21.ª: **el borde de Railway
sobrescribe la cabecera**, así que el límite por IP no se puede esquivar enviándola.

**Rendimiento** (tiempo en `api` según sus logs; desde fuera hay que sumar la red, ~180 ms de
mediana hasta Railway desde el equipo de medición, igual que `/health`):

| Operación | p50 | p95 | Objetivo |
| --- | --- | --- | --- |
| `POST /auth/login` (20 peticiones) | 15 ms | 19 ms | < 300 ms |
| "Mis proyectos" con 100 proyectos (59) | 5 ms | 8 ms | < 200 ms |

