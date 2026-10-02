import {
  RELAYED_EVENTS,
  detailPermissions,
  type Comment,
  type Detail,
  type DomainEvents,
  type AccessRevoked,
  type JoinAck,
  type PresenceEntry,
  type ProjectRoom,
  type ProjectStatus,
  type PublicDetail,
  type RelayedEventName,
  type Role,
} from '@reqcanvas/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { detailKeys, type DetailsQuery } from '../details/api';
import { diagramKeys } from '../diagrams/api';
import { projectKeys } from '../projects/api';
import type { RealtimeSocket } from './socket';

/** Quién mira y qué: para calcular permisos y saber qué invalidar. */
export type SyncContext = {
  userId: string;
  role: Role;
  projectStatus: ProjectStatus;
  projectId: string;
  /** Versión mostrada (su cobertura se invalida con cada evento de detalles). */
  versionId: string;
};

type Payload<N extends RelayedEventName> = DomainEvents[N] & { eventId: string };

const matches = (detail: Pick<Detail, 'status' | 'type' | 'priority' | 'tags'>, q: DetailsQuery) =>
  (!q.status || detail.status === q.status) &&
  (!q.type || detail.type === q.type) &&
  (!q.priority || detail.priority === q.priority) &&
  (!q.tag || detail.tags.includes(q.tag));

/** Aplica `change` a cada lista de detalles en caché bajo `prefix` (con su filtro y orden). */
function updateLists(
  client: QueryClient,
  prefix: readonly unknown[],
  change: (list: Detail[], query: DetailsQuery) => Detail[],
) {
  for (const [key, data] of client.getQueriesData<Detail[]>({ queryKey: prefix })) {
    const query = key[3] as DetailsQuery | undefined;
    if (!Array.isArray(data) || !query || typeof query !== 'object') continue;
    client.setQueryData(key, change(data, query));
  }
}

const permissionsFor = (
  detail: Pick<Detail, 'status' | 'author'>,
  ctx: SyncContext,
): Detail['permissions'] =>
  detailPermissions(
    { status: detail.status, authorId: detail.author.id },
    { userId: ctx.userId, role: ctx.role },
    ctx.projectStatus,
  );

/** Detalle del socket con los datos del usuario actual (plan de la 005, ajuste 7). */
const forViewer = (detail: PublicDetail, ctx: SyncContext): Detail => ({
  ...detail,
  votedByMe: false,
  permissions: permissionsFor(detail, ctx),
});

/** Posición de un detalle nuevo: con orden por votos, tras los más votados; si no, el primero. */
function insert(list: Detail[], detail: Detail, query: DetailsQuery): Detail[] {
  const index =
    query.sort === 'votes' ? list.findIndex((item) => item.voteCount <= detail.voteCount) : 0;
  const at = index === -1 ? list.length : index;
  return [...list.slice(0, at), detail, ...list.slice(at)];
}

function updateComments(
  client: QueryClient,
  detailId: string,
  change: (list: Comment[]) => Comment[],
): { had: boolean } {
  const key = detailKeys.comments(detailId);
  const current = client.getQueryData<Comment[]>(key);
  if (!current) return { had: false };
  client.setQueryData(key, change(current));
  return { had: true };
}

function changeCommentCount(client: QueryClient, diagramId: string, detailId: string, by: number) {
  updateLists(client, ['details', diagramId], (list) =>
    list.map((item) =>
      item.id === detailId ? { ...item, commentCount: Math.max(0, item.commentCount + by) } : item,
    ),
  );
}

/**
 * Aplica un evento retransmitido sobre la caché de TanStack Query (plan de la 005, ajuste 6):
 * con su payload, sin volver a pedir los datos, salvo la cobertura (en segundo plano).
 * Idempotente: repetir un evento o recibir el propio no duplica nada.
 */
export function applyRealtimeEvent<N extends RelayedEventName>(
  client: QueryClient,
  name: N,
  payload: Payload<N>,
  ctx: SyncContext,
): void {
  if (name === 'diagram.published') {
    const event = payload as Payload<'diagram.published'>;
    void client.invalidateQueries({ queryKey: diagramKeys.list(event.projectId) });
    void client.invalidateQueries({ queryKey: diagramKeys.version(event.versionId) });
    return;
  }

  switch (name) {
    case 'detail.created': {
      const { detail } = payload as Payload<'detail.created'>;
      const added = forViewer(detail, ctx);
      updateLists(client, detailKeys.activity(detail.diagramId, detail.activityKey), (list, q) =>
        list.some((item) => item.id === detail.id) || !matches(detail, q)
          ? list
          : insert(list, added, q),
      );
      break;
    }
    case 'detail.updated': {
      const { detail } = payload as Payload<'detail.updated'>;
      updateLists(client, detailKeys.activity(detail.diagramId, detail.activityKey), (list) =>
        list.map((item) =>
          item.id === detail.id && detail.rev > item.rev
            ? { ...item, ...detail, permissions: item.permissions, votedByMe: item.votedByMe }
            : item,
        ),
      );
      break;
    }
    case 'detail.deleted': {
      const event = payload as Payload<'detail.deleted'>;
      updateLists(client, detailKeys.activity(event.diagramId, event.activityKey), (list) =>
        list.filter((item) => item.id !== event.detailId),
      );
      break;
    }
    case 'detail.status_changed': {
      const event = payload as Payload<'detail.status_changed'>;
      updateLists(client, detailKeys.activity(event.diagramId, event.activityKey), (list, q) =>
        list.flatMap((item) => {
          if (item.id !== event.detailId) return [item];
          const changed = {
            ...item,
            status: event.status,
            duplicateOf: event.duplicateOf ?? null,
            discardReason: event.discardReason ?? null,
          };
          const next = { ...changed, permissions: permissionsFor(changed, ctx) };
          return matches(next, q) ? [next] : [];
        }),
      );
      break;
    }
    case 'detail.reassigned': {
      const event = payload as Payload<'detail.reassigned'>;
      updateLists(
        client,
        detailKeys.activity(event.from.diagramId, event.from.activityKey),
        (list) => list.filter((item) => item.id !== event.detailId),
      );
      // El evento no trae el detalle: la actividad de destino y los huérfanos se vuelven a pedir.
      void client.invalidateQueries({
        queryKey: detailKeys.activity(event.to.diagramId, event.to.activityKey),
      });
      void client.invalidateQueries({ queryKey: detailKeys.orphans(event.projectId) });
      break;
    }
    case 'vote.changed': {
      const event = payload as Payload<'vote.changed'>;
      updateLists(client, ['details', event.diagramId], (list) =>
        list.map((item) =>
          item.id === event.detailId
            ? {
                ...item,
                voteCount: event.voteCount,
                votedByMe: event.userId === ctx.userId ? event.voted : item.votedByMe,
              }
            : item,
        ),
      );
      break;
    }
    case 'comment.created': {
      const { comment, diagramId } = payload as Payload<'comment.created'>;
      const mine = comment.author.id === ctx.userId;
      const open = ctx.projectStatus === 'open';
      const known = client
        .getQueryData<Comment[]>(detailKeys.comments(comment.detailId))
        ?.some((item) => item.id === comment.id);
      if (known) break;
      updateComments(client, comment.detailId, (list) => [
        ...list,
        {
          ...comment,
          permissions: { canEdit: open && mine, canDelete: open && (mine || ctx.role === 'admin') },
        },
      ]);
      changeCommentCount(client, diagramId, comment.detailId, 1);
      break;
    }
    case 'comment.updated': {
      const { comment } = payload as Payload<'comment.updated'>;
      updateComments(client, comment.detailId, (list) =>
        list.map((item) =>
          item.id === comment.id ? { ...item, ...comment, permissions: item.permissions } : item,
        ),
      );
      break;
    }
    case 'comment.deleted': {
      const event = payload as Payload<'comment.deleted'>;
      const cached = client.getQueryData<Comment[]>(detailKeys.comments(event.detailId));
      if (cached && !cached.some((item) => item.id === event.commentId)) break;
      updateComments(client, event.detailId, (list) =>
        list.filter((item) => item.id !== event.commentId),
      );
      changeCommentCount(client, event.diagramId, event.detailId, -1);
      break;
    }
  }
  // Los contadores, las marcas y el mapa de calor del diagrama.
  void client.invalidateQueries({ queryKey: detailKeys.coverage(ctx.versionId) });
}

/**
 * Sala de la versión mostrada: se une, y al cambiar de versión sale de la anterior (U3). Tras
 * una desconexión vuelve a unirse al reconectar y avisa con `onReconnect` (US4).
 */
export function useRealtimeRoom(
  socket: RealtimeSocket | null,
  versionId: string | null,
  onReconnect?: () => void,
) {
  const [status, setStatus] = useState<'idle' | 'joining' | 'joined' | 'denied'>('idle');
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const reconnectRef = useRef(onReconnect);
  reconnectRef.current = onReconnect;

  useEffect(() => {
    if (!socket || !versionId) {
      setStatus('idle');
      return;
    }
    const join = () => {
      setStatus('joining');
      socket.emit('room:join', { versionId }, (ack: JoinAck) => {
        setPresence(ack.ok ? ack.presence : []);
        setStatus(ack.ok ? 'joined' : 'denied');
      });
    };
    let lost = false;
    const onDisconnect = () => {
      lost = true;
      setStatus('joining');
    };
    const onConnect = () => {
      if (!lost) return;
      lost = false;
      join();
      reconnectRef.current?.();
    };
    const listener = socket as unknown as Listener;
    listener.on('disconnect', onDisconnect);
    listener.on('connect', onConnect);
    join();
    return () => {
      listener.off('disconnect', onDisconnect);
      listener.off('connect', onConnect);
      socket.emit('room:leave', { versionId });
    };
  }, [socket, versionId]);

  return { status, presence };
}

type Listener = { on(name: string, h: unknown): unknown; off(name: string, h: unknown): unknown };

/** Aviso al llegar a "Mis proyectos" tras perder el acceso (FR-008). */
export const REVOKED_NOTICE = 'Ya no tienes acceso a este proyecto.';

/**
 * Ciclo de vida del espacio de trabajo en tiempo real (US4): la sala, resincronizar al
 * reconectar (SC-003: lo ocurrido mientras tanto se vuelve a pedir), salir al perder el acceso
 * y pasar a solo lectura al cerrarse el proyecto.
 */
export function useRealtimeLifecycle(
  socket: RealtimeSocket | null,
  { projectId, versionId }: { projectId: string; versionId: string | null },
) {
  const client = useQueryClient();
  const navigate = useNavigate();

  const room = useRealtimeRoom(socket, versionId, () => {
    void client.invalidateQueries({ queryKey: detailKeys.all });
    void client.invalidateQueries({ queryKey: diagramKeys.list(projectId) });
    void client.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    if (versionId) void client.invalidateQueries({ queryKey: diagramKeys.version(versionId) });
  });

  useEffect(() => {
    if (!socket) return;
    const listener = socket as unknown as Listener;
    const onRevoked = (event: AccessRevoked) => {
      if (event.projectId !== projectId) return;
      navigate('/proyectos', { state: { notice: REVOKED_NOTICE } });
    };
    // La web deriva la solo lectura del estado del proyecto (004, `projectOpen`).
    const onStatus = (event: ProjectRoom) => {
      if (event.projectId === projectId) {
        void client.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      }
    };
    listener.on('access:revoked', onRevoked);
    listener.on('project:closed', onStatus);
    listener.on('project:reopened', onStatus);
    return () => {
      listener.off('access:revoked', onRevoked);
      listener.off('project:closed', onStatus);
      listener.off('project:reopened', onStatus);
    };
  }, [socket, projectId, client, navigate]);

  return room;
}

/** Aplica los eventos del socket mientras el componente está montado. */
export function useRealtimeSync(socket: RealtimeSocket | null, ctx: SyncContext | null) {
  const client = useQueryClient();
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    if (!socket) return;
    // Un mismo evento (mismo `eventId`) se aplica una sola vez.
    const seen = new Set<string>();
    const handlers = RELAYED_EVENTS.map((name) => {
      const handler = (payload: Payload<typeof name>) => {
        if (!ctxRef.current || seen.has(payload.eventId)) return;
        seen.add(payload.eventId);
        if (seen.size > 500) seen.delete(seen.values().next().value!);
        applyRealtimeEvent(client, name, payload, ctxRef.current);
      };
      (socket as unknown as { on: (n: string, h: unknown) => void }).on(name, handler);
      return [name, handler] as const;
    });
    return () => {
      for (const [name, handler] of handlers) {
        (socket as unknown as { off: (n: string, h: unknown) => void }).off(name, handler);
      }
    };
  }, [socket, client]);
}
