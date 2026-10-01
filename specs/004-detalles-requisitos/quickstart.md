# Quickstart: Detalles de requisitos por actividad

Requiere 001–003 y un proyecto *Abierto* con el diagrama "Proceso de compra"
(`compra-simple.png`, 6 actividades) publicado, con Ana (Admin) y Luis y Marta
(Participantes). Los helpers de `e2e/flows/details.ts` crean estos datos por la API.

## 1. Registrar (US1)

1. Como Luis, seleccionar "Validar pago" → se abre el panel.
2. Dado: "el cliente tiene productos en el carrito"; Cuando: "paga con tarjeta"; Entonces:
   "el sistema confirma el pago en menos de 5 segundos"; Tipo: No funcional → guardar
   (SC-001: < 2 min).
3. Intentar guardar con "Entonces" vacío → bloqueado; se indica el campo.

## 2. Editar y conflicto (US2)

1. Luis edita su detalle → *Historial* muestra la versión anterior.
2. Marta no ve las opciones de editar ni eliminar en el detalle de Luis.
3. Abrir el detalle de Luis en dos pestañas (Luis y Ana), guardar en ambas → la segunda ve
   `ConflictDialog` con las diferencias.

## 3. Indicadores (US3)

1. Con detalles en 3 de las 6 actividades: contadores en 3 zonas y 3 marcas "sin detalles".
2. Activar *Mapa de calor* → colores con leyenda; desplegar las notas de "Validar pago".

## 4. Votos y comentarios (US4)

1. Marta vota el detalle de Luis → contador 1; vuelve a pulsar → 0.
2. Luis intenta votar su propio detalle → no está disponible.
3. Marta comenta "¿Aplica también a PayPal?" → aparece debajo con su nombre.

## 5. Moderación (US5)

1. Ana marca un detalle como *Duplicado de…* → aparece atenuado, con enlace al original, y
   sus votos se suman al original en las notas.
2. Ana *descarta* otro con el motivo "Fuera de alcance" → Luis ve el motivo.
3. Filtrar el panel por *Validado*.
4. Cerrar el proyecto → el formulario y los votos desaparecen; los detalles siguen visibles.
5. Subir una versión 2 del diagrama, eliminar en ella "Validar pago" (avisa de cuántos
   requisitos tiene) y publicarla → sus detalles aparecen en *Diagramas → Requisitos sin
   actividad* y Ana los reasigna a otra actividad publicada.

## Recorrido en staging (T052, 2026-10-01)

Con un Administrador y dos Participantes nuevos, sobre `5a7f6c0` (flag `details` activado solo en
staging). Automatizado con Playwright y la ventana visible; como en staging no hay
`__canvasState`, las actividades se seleccionan con la lista accesible del canvas (`Tab` +
`Enter`).

| § | Comprobación | Resultado |
|---|--------------|-----------|
| 1 | Luis registra el requisito de "Validar pago" | Guardado con su nombre y visible al recargar; 1,3 s automatizado (SC-001: < 2 min) |
| 1 | Sin "Entonces" | Bloqueado con "Escribe el resultado (Entonces): al menos 5 caracteres." |
| 2 | Edición e historial | El historial muestra la versión anterior |
| 2 | Marta en el detalle de Luis | Sin *Editar* ni *Eliminar* |
| 2 | Ana y Luis guardan a la vez | Luis ve la comparación y conserva lo suyo |
| 3 | Requisitos en 3 de las 6 actividades | 3 contadores, 3 marcas «Sin detalles», leyenda del mapa de calor y notas |
| 4 | Votos y comentario | Marta: 1 → 0 votos y comentario con su nombre; Luis no puede votar el suyo |
| 5 | Duplicado | Atenuado con enlace al original; el voto del duplicado cuenta en el original (`effectiveVotes` 1) |
| 5 | Descarte y filtro | Luis ve "Motivo del descarte: Fuera de alcance"; el filtro *Validado* deja uno |
| 5 | Versión 2 sin "Validar pago" | `409 HAS_DEPENDENTS` con "Esta actividad tiene 3 requisito(s) asociado(s)…"; al publicar, 3 en *Requisitos sin actividad*, reasignados a "Emitir factura" |
| 5 | Proyecto cerrado | Detalles visibles, sin formulario; escribir responde `409`. **Fallo**: quien ya había votado veía *Votar* habilitado (la web dejaba retirar el voto y la API lo rechaza); corregido en `f30c101`, con una prueba de web y el caso en el E2E de moderación |

Mediciones (Chrome con ventana, Apple M1, contra staging):

| Medida | Objetivo | Resultado |
|--------|----------|-----------|
| FPS con `cien-actividades.png`, 50 contadores, 50 marcas y el mapa de calor | ≥ 50 | 60 FPS al hacer zoom y al desplazar (p95 de 17–18 ms) |
| Panel de una actividad con 200 detalles, desde `Enter` hasta verlos | < 1 s (SC-003) | 0,37–0,40 s |
| Cobertura de 100 actividades con 249 detalles, por el proxy | < 200 ms p95 | 295 ms p95; una petición trivial (`/api/me`) da 277 ms p95 intercalada con la cobertura, que solo añade ~15 ms: el resto es la red hasta Railway |

- Los 200 detalles se crearon por la API con 4 cuentas (50 cada una) por el límite de 60
  escrituras por minuto y usuario; en staging no se insertan 5 000 directamente en la base de
  datos, así que la cobertura con 5 000 se queda con la medida local (75 ms p95, plan.md).
- El proyecto y las cuentas de prueba (`t052-…@example.com`) se quedan en staging: no hay borrado
  de cuentas.

## 6. Pruebas

```bash
pnpm test:services:up
pnpm --filter @reqcanvas/api exec vitest run details votes-comments coverage moderation authorization.matrix
pnpm dev:up && pnpm e2e --project flows
```
