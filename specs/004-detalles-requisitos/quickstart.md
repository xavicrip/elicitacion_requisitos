# Quickstart: Detalles de requisitos por actividad

Requiere 001–003 y un proyecto *Abierto* con el diagrama "Proceso de compra" publicado
(10 actividades), con Ana (Admin) y Luis y Marta (Participantes). Hay datos de ejemplo con
`pnpm --filter api seed:demo`.

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

1. Con detalles en 3 de las 10 actividades: contadores en 3 zonas y 7 marcas "sin detalles".
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

## 6. Pruebas

```bash
pnpm --filter api test -- details votes comments coverage authorization.matrix
pnpm e2e -- details-create details-edit votes-comments moderation coverage
```
