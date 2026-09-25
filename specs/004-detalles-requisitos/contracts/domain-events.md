# Contrato: eventos de dominio de detalles

Emitidos por `apps/api/src/modules/details/events.ts` **después** de que la escritura se
confirma en MongoDB. Tipados en `packages/shared/src/events.ts`. En la 004 los consume el
servicio de auditoría; la 005 los retransmite a la sala `project:{projectId}` de Socket.IO.

| Evento | Payload (además de `projectId`, `diagramId`, `actorId`, `at`) |
|--------|----------------------------------------------------------------|
| `detail.created` | `detail: Detail` (sin `permissions` ni `votedByMe`) |
| `detail.updated` | `detail: Detail`, `rev` |
| `detail.deleted` | `detailId`, `activityKey` |
| `detail.status_changed` | `detailId`, `activityKey`, `status`, `duplicateOf?`, `discardReason?` |
| `detail.reassigned` | `detailId`, `from: {diagramId, activityKey}`, `to: {diagramId, activityKey}` |
| `vote.changed` | `detailId`, `voteCount`, `userId`, `voted: boolean` |
| `comment.created` / `comment.updated` | `comment: Comment` |
| `comment.deleted` | `commentId`, `detailId` |

Reglas:
- Los payloads no incluyen datos calculados por usuario (`permissions`, `votedByMe`); el
  cliente los recalcula o vuelve a consultar.
- Los eventos son notificaciones; la fuente de verdad sigue siendo la API REST.
