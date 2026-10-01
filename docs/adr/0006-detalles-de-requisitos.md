# ADR 0006: Detalles de requisitos anclados a la `key` de la actividad

- **Estado**: aceptado
- **Fecha**: 2026-10-01
- **Feature**: 004-detalles-requisitos (research R1–R10; plan, ajustes 1–12)

## Contexto

La 004 permite registrar requisitos con la estructura Dado / Cuando / Entonces sobre cada
actividad de un diagrama, votarlos, comentarlos y moderarlos, y muestra la cobertura en el canvas
de la 003. Los diagramas tienen versiones: una versión nueva copia las actividades de la anterior
con la misma `key` (003, FR-008) y puede añadir o quitar actividades. Varias personas pueden
editar el mismo requisito, y los votos llegan a la vez.

## Decisión

1. **Ancla por `activityKey`, no por el `_id` de la actividad.** Un detalle guarda `projectId`,
   `diagramId` y `activityKey`, y al crearse esa `key` debe estar en la versión **publicada**
   (`404` si no). Como la `key` se conserva entre versiones, los requisitos sobreviven a una versión
   nueva sin migrarlos.
2. **Huérfanos en lugar de borrado.** Borrar en un borrador una actividad con requisitos pide
   confirmación con el conteo (registro de dependientes de la 003), pero no los borra: cuando se
   publica la versión sin esa actividad, quedan huérfanos y el Administrador los reasigna desde
   _Requisitos sin actividad_. Los huérfanos se calculan por consulta (su `key` no está en la
   versión publicada) y no cuentan en la cobertura. Así se lee el Principio I ("todo detalle
   pertenece a una actividad de un diagrama publicado"): el ancla es la `key` de una versión
   publicada, la vigente o una archivada, y el estado de huérfano es temporal, con un responsable
   claro, en lugar de perder aportes por un cambio del diagrama.
3. **Concurrencia optimista con `rev`.** `PATCH /details/:id` exige `If-Match` (`428` sin él) y
   un `rev` desactualizado recibe `409` con el detalle actual; la web compara las dos versiones
   campo a campo (jsdiff, cargado en diferido) y deja elegir. Antes de cada cambio, la versión
   anterior se guarda completa en `detail_history` (edición, moderación o reasignación).
4. **Votos con índice único y contador desnormalizado.** `detail_votes` tiene un índice único
   `{detailId, userId}`; `voteCount` solo se incrementa (o decrementa) si la inserción (o el
   borrado) del voto tuvo éxito, así que es exacto con votos simultáneos y sin transacciones. Los
   votos de un duplicado se suman al original al ordenar y en la cobertura (votos efectivos).
5. **Permisos calculados en el servidor.** Cada detalle y comentario llega con `permissions`
   para el usuario que consulta (autor, Administrador, estado del detalle y del proyecto); la web
   solo los refleja. Un proyecto que no está abierto es de solo lectura para todos (`409
PROJECT_NOT_OPEN`). Las escrituras tienen un límite de 60 por minuto y usuario.
6. **Eventos de dominio en proceso.** Tras cada escritura confirmada se emite un evento tipado
   (`contracts/domain-events.md`) sin datos calculados por usuario. En la 004 los consume la
   auditoría; la 005 los retransmitirá por Socket.IO sin tocar la lógica de negocio.
7. **Indicadores sobre los puntos de extensión de la 003.** Contadores, marca «Sin detalles»,
   notas y mapa de calor (escala por cuantiles, YlOrRd) usan `renderBadge`, `colorFor` y
   `sidePanel`; la cobertura es una agregación sin contadores por actividad que mantener. Con
   100 zonas y los indicadores activos, el canvas sigue a 60 FPS.

## Alternativas descartadas

- **Anclar al `_id` de la actividad**: obligaría a migrar los requisitos en cada versión del
  diagrama.
- **Borrar los requisitos de una actividad eliminada**: perdería aportes de los participantes por
  un cambio del diagrama que quizá solo la renombra o la divide.
- **CRDT o bloqueo pesimista para la edición**: desproporcionados para textos cortos que edita
  sobre todo su autor.
- **Votos embebidos en el detalle**: el array crece sin límite y la unicidad bajo concurrencia es
  más difícil de garantizar.
- **Contadores de cobertura desnormalizados por actividad**: habría que mantenerlos al crear,
  borrar, moderar y reasignar; la agregación responde en 75 ms p95 con 5 000 detalles.

## Consecuencias

- El Administrador tiene una tarea más: revisar los huérfanos al publicar versiones que quitan
  actividades.
- La ordenación por votos efectivos se hace en memoria (≤ 200 detalles por actividad); si una
  actividad acumulara muchos más, habría que precalcularlos.
- Los eventos son en proceso: con varias réplicas de `api`, la 005 tendrá que publicarlos a través
  de Redis para que lleguen a todos los clientes.
- El historial guarda versiones completas: ocupa más que guardar diferencias, pero con el volumen
  esperado (≤ 5 000 detalles por proyecto, pocas ediciones) es irrelevante.
