# Contrato: matriz de autorización

Leyenda: ✅ permitido · 403 miembro sin permiso · 404 no miembro (se responde como si el
recurso no existiera) · 401 sin sesión. Esta matriz se prueba de forma exhaustiva en
`apps/api/tests/integration/authorization.matrix.test.ts` y la amplían las features 003–008
con sus propias filas.

| Operación | Anónimo | No miembro | Participante | Administrador |
|-----------|---------|------------|--------------|---------------|
| `GET /projects` (mis proyectos) | 401 | ✅ (lista vacía) | ✅ | ✅ |
| `POST /projects` | 401 | ✅ | ✅ | ✅ |
| `GET /projects/:id` | 401 | 404 | ✅ | ✅ |
| `PATCH /projects/:id` | 401 | 404 | 403 | ✅ |
| `DELETE /projects/:id` | 401 | 404 | 403 | ✅ |
| `POST /projects/:id/status` | 401 | 404 | 403 | ✅ |
| `GET /projects/:id/members` | 401 | 404 | ✅ | ✅ |
| `PATCH /projects/:id/members/:uid` | 401 | 404 | 403 | ✅ (409 si deja 0 admins) |
| `DELETE /projects/:id/members/:uid` (otro) | 401 | 404 | 403 | ✅ (409 si deja 0 admins) |
| `DELETE /projects/:id/members/:uid` (uno mismo) | 401 | 404 | ✅ | ✅ (409 si es el último admin) |
| `GET/POST /projects/:id/invitations` | 401 | 404 | 403 | ✅ |
| `DELETE /projects/:id/invitations/:iid` | 401 | 404 | 403 | ✅ |
| `GET /invitations/:token` | ✅ | ✅ | ✅ | ✅ |
| `POST /invitations/:token/accept` | 401 | ✅ | ✅ (idempotente) | ✅ (idempotente, conserva el rol) |

Reglas adicionales:
- Un proyecto en `deleting` responde 404 a todos.
- Retirar a un miembro invalida su acceso en la siguiente petición (el guard consulta la
  membresía en cada petición; no se cachea en el JWT).
