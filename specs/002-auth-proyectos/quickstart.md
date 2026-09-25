# Quickstart: Autenticación, roles y gestión de proyectos

Requiere el entorno de la feature 001 (`pnpm dev:up`) y las nuevas variables `JWT_SECRET` y
`APP_BASE_URL` en `.env`. La app se abre en `http://localhost:5173`; la API responde en
`/api` a través del proxy de Caddy.

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

```bash
# Con el token de Luis (Participante), obtenido desde las herramientas de desarrollo:
curl -i -X POST localhost:5173/api/projects/<id>/invitations -H "Authorization: Bearer $TOKEN_LUIS"   # 403
curl -i localhost:5173/api/projects/<id-de-otro-proyecto> -H "Authorization: Bearer $TOKEN_LUIS"     # 404
```

## 5. Pruebas automatizadas

```bash
pnpm --filter api test -- authorization.matrix   # matriz completa en verde (SC-003)
pnpm e2e -- auth invitations access-control
```
