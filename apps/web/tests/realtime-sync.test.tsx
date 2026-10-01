import type { Comment, Detail } from '@reqcanvas/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detailKeys } from '../src/features/details/api';
import { DetailForm } from '../src/features/details/DetailForm';
import { diagramKeys } from '../src/features/diagrams/api';
import {
  applyRealtimeEvent,
  useRealtimeRoom,
  type SyncContext,
} from '../src/features/realtime/useRealtimeSync';
import { json, mockApi } from './helpers/api';
import { detail, KEY } from './helpers/details';

// US1 de la 005 (plan, ajustes 6 y 7): los eventos se aplican con su payload sobre la caché.

const ctx: SyncContext = {
  userId: 'u1',
  role: 'participant',
  projectStatus: 'open',
  projectId: 'p1',
  versionId: 'v1',
};
const base = { projectId: 'p1', diagramId: 'd1', actorId: 'u2', at: '2026-10-01T11:00:00.000Z' };
const listKey = detailKeys.list('d1', KEY, { sort: 'votes' });
const filteredKey = detailKeys.list('d1', KEY, { sort: 'votes', status: 'validated' });
/** Lo que llega por el socket: sin `permissions` ni `votedByMe`. */
const wire = (overrides: Partial<Detail> = {}) => {
  const { permissions: _p, votedByMe: _v, ...rest } = detail(overrides);
  return rest;
};
let eventCount = 0;
const event = <T extends object>(payload: T) => ({ ...payload, eventId: `e${++eventCount}` });

function setup(initial: Detail[] = [detail()]) {
  const client = new QueryClient();
  client.setQueryData(listKey, initial);
  return client;
}
const list = (client: QueryClient, key: readonly unknown[] = listKey) =>
  client.getQueryData<Detail[]>(key)!;

describe('detalles', () => {
  it('detail.created añade el detalle con los permisos del usuario actual', () => {
    const client = setup();
    applyRealtimeEvent(
      client,
      'detail.created',
      event({ ...base, detail: wire({ id: 'x2', author: { id: 'u2', name: 'Luis' } }) }),
      ctx,
    );
    const added = list(client).find((item) => item.id === 'x2')!;
    expect(added.votedByMe).toBe(false);
    expect(added.permissions).toEqual({
      canEdit: false,
      canDelete: false,
      canVote: true,
      canModerate: false,
    });
  });

  it('un detalle propio o repetido no se duplica', () => {
    const client = setup();
    const created = event({ ...base, detail: wire() });
    applyRealtimeEvent(client, 'detail.created', created, ctx);
    applyRealtimeEvent(client, 'detail.created', { ...created, eventId: 'otro' }, ctx);
    expect(list(client)).toHaveLength(1);
  });

  it('no añade a una lista filtrada un detalle que no cumple el filtro', () => {
    const client = setup();
    client.setQueryData(filteredKey, []);
    applyRealtimeEvent(
      client,
      'detail.created',
      event({ ...base, detail: wire({ id: 'x2' }) }),
      ctx,
    );
    expect(list(client, filteredKey)).toEqual([]);
    expect(list(client)).toHaveLength(2);
  });

  it('detail.updated: con rev mayor sustituye y conserva permissions y votedByMe; con rev ≤, se ignora', () => {
    const client = setup([detail({ rev: 1, votedByMe: true })]);
    applyRealtimeEvent(
      client,
      'detail.updated',
      event({ ...base, detail: wire({ rev: 0, then: 'antiguo' }), rev: 0 }),
      ctx,
    );
    expect(list(client)[0]!.then).toBe('el sistema confirma el pago');
    applyRealtimeEvent(
      client,
      'detail.updated',
      event({ ...base, detail: wire({ rev: 2, then: 'nuevo' }), rev: 2 }),
      ctx,
    );
    expect(list(client)[0]).toMatchObject({ then: 'nuevo', rev: 2, votedByMe: true });
    expect(list(client)[0]!.permissions).toEqual(detail().permissions);
  });

  it('detail.deleted lo quita', () => {
    const client = setup();
    applyRealtimeEvent(
      client,
      'detail.deleted',
      event({ ...base, detailId: 'x1', activityKey: KEY }),
      ctx,
    );
    expect(list(client)).toEqual([]);
  });

  it('detail.status_changed cambia el estado y recalcula los permisos', () => {
    const client = setup();
    applyRealtimeEvent(
      client,
      'detail.status_changed',
      event({
        ...base,
        detailId: 'x1',
        activityKey: KEY,
        status: 'discarded',
        discardReason: 'Fuera de alcance',
      }),
      ctx,
    );
    expect(list(client)[0]).toMatchObject({
      status: 'discarded',
      discardReason: 'Fuera de alcance',
    });
    expect(list(client)[0]!.permissions.canVote).toBe(false);
  });

  it('detail.reassigned lo quita de la actividad de origen', () => {
    const client = setup();
    applyRealtimeEvent(
      client,
      'detail.reassigned',
      event({
        ...base,
        detailId: 'x1',
        from: { diagramId: 'd1', activityKey: KEY },
        to: { diagramId: 'd1', activityKey: 'otra' },
      }),
      ctx,
    );
    expect(list(client)).toEqual([]);
  });
});

describe('votos y comentarios', () => {
  it('vote.changed fija el contador absoluto; votedByMe solo cambia si votó el usuario actual', () => {
    const client = setup();
    applyRealtimeEvent(
      client,
      'vote.changed',
      event({ ...base, detailId: 'x1', voteCount: 5, userId: 'u9', voted: true }),
      ctx,
    );
    expect(list(client)[0]).toMatchObject({ voteCount: 5, votedByMe: false });
    applyRealtimeEvent(
      client,
      'vote.changed',
      event({ ...base, detailId: 'x1', voteCount: 6, userId: 'u1', voted: true }),
      ctx,
    );
    expect(list(client)[0]).toMatchObject({ voteCount: 6, votedByMe: true });
  });

  it('comment.* actualiza el contador y la lista de comentarios abierta', () => {
    const client = setup();
    const comments = detailKeys.comments('x1');
    client.setQueryData<Comment[]>(comments, []);
    const comment = {
      id: 'c1',
      detailId: 'x1',
      text: '¿Y PayPal?',
      author: { id: 'u2', name: 'Luis' },
      createdAt: base.at,
      editedAt: null,
    };
    applyRealtimeEvent(client, 'comment.created', event({ ...base, comment }), ctx);
    expect(list(client)[0]!.commentCount).toBe(1);
    expect(client.getQueryData<Comment[]>(comments)).toEqual([
      { ...comment, permissions: { canEdit: false, canDelete: false } },
    ]);
    applyRealtimeEvent(
      client,
      'comment.updated',
      event({ ...base, comment: { ...comment, text: '¿Y Bizum?' } }),
      ctx,
    );
    expect(client.getQueryData<Comment[]>(comments)![0]!.text).toBe('¿Y Bizum?');
    applyRealtimeEvent(
      client,
      'comment.deleted',
      event({ ...base, commentId: 'c1', detailId: 'x1' }),
      ctx,
    );
    expect(client.getQueryData<Comment[]>(comments)).toEqual([]);
    expect(list(client)[0]!.commentCount).toBe(0);
  });
});

describe('invalidaciones', () => {
  it('cada evento de detalles invalida la cobertura de la versión mostrada', () => {
    const client = setup();
    client.setQueryData(detailKeys.coverage('v1'), []);
    applyRealtimeEvent(
      client,
      'vote.changed',
      event({ ...base, detailId: 'x1', voteCount: 1, userId: 'u9', voted: true }),
      ctx,
    );
    expect(client.getQueryState(detailKeys.coverage('v1'))!.isInvalidated).toBe(true);
  });

  it('diagram.published invalida la versión y la lista de diagramas', () => {
    const client = setup();
    client.setQueryData(diagramKeys.list('p1'), []);
    client.setQueryData(diagramKeys.version('v2'), {});
    applyRealtimeEvent(
      client,
      'diagram.published',
      event({ projectId: 'p1', diagramId: 'd1', versionId: 'v2', actorId: 'u2', at: base.at }),
      ctx,
    );
    expect(client.getQueryState(diagramKeys.list('p1'))!.isInvalidated).toBe(true);
    expect(client.getQueryState(diagramKeys.version('v2'))!.isInvalidated).toBe(true);
  });
});

describe('sala de la versión mostrada (U3)', () => {
  it('se une a la versión y cambia de sala cuando cambia la versión', async () => {
    const emitted: Array<[string, unknown]> = [];
    const socket = {
      emit: (name: string, payload: unknown, ack?: (result: unknown) => void) => {
        emitted.push([name, payload]);
        ack?.({ ok: true, presence: [] });
      },
      on: () => socket,
      off: () => socket,
    };
    const { result, rerender, unmount } = renderHook(
      ({ versionId }) => useRealtimeRoom(socket as never, versionId),
      { initialProps: { versionId: 'v1' } },
    );
    expect(result.current.status).toBe('joined');
    rerender({ versionId: 'v2' });
    expect(emitted).toEqual([
      ['room:join', { versionId: 'v1' }],
      ['room:leave', { versionId: 'v1' }],
      ['room:join', { versionId: 'v2' }],
    ]);
    unmount();
    expect(emitted.at(-1)).toEqual(['room:leave', { versionId: 'v2' }]);
  });
});

describe('edición con eventos entrantes (U1, edge case de la spec)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('el formulario conserva lo escrito y guarda con el rev con que se abrió', async () => {
    const api = mockApi({
      // 409 de la 004: el cuerpo es el detalle actual.
      'PATCH /api/details/x1': () => json(409, detail({ rev: 1, then: 'lo de la otra persona' })),
    });
    const client = new QueryClient();
    const wrap = (node: ReactNode) => (
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    );
    const props = { projectId: 'p1', diagramId: 'd1', activityKey: KEY, facets: undefined };
    const opened = detail({
      rev: 0,
      permissions: { canEdit: true, canDelete: true, canVote: false, canModerate: false },
    });
    const { rerender } = render(wrap(<DetailForm {...props} detail={opened} />));
    const field = screen.getByLabelText('Entonces (resultado)');
    await userEvent.clear(field);
    await userEvent.type(field, 'lo mío');
    // Llega detail.updated de otra persona: la caché cambia y el formulario se vuelve a pintar.
    rerender(
      wrap(<DetailForm {...props} detail={{ ...opened, rev: 1, then: 'lo de la otra persona' }} />),
    );
    expect(screen.getByLabelText('Entonces (resultado)')).toHaveValue('lo mío');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(
      await screen.findByRole('dialog', { name: 'Otra persona modificó este requisito' }),
    ).toBeInTheDocument();
    expect(api.requests.find((r) => r.method === 'PATCH')?.ifMatch).toBe('"0"');
  });
});
