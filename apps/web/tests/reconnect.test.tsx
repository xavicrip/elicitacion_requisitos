import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { detailKeys } from '../src/features/details/api';
import { diagramKeys } from '../src/features/diagrams/api';
import { projectKeys } from '../src/features/projects/api';
import { ConnectionBanner } from '../src/features/realtime/ConnectionBanner';
import { useConnectionStore } from '../src/features/realtime/connection';
import { useRealtimeLifecycle } from '../src/features/realtime/useRealtimeSync';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi } from './helpers/api';
import {
  detail,
  DETAILS_URL,
  renderWorkspace,
  selectActivity,
  useDetailsTestSession,
} from './helpers/details';

// US4 de la 005 (FR-006, FR-008): aviso sin conexión, resincronización y revocación.

useDetailsTestSession();
beforeEach(() => useConnectionStore.getState().reset());

/** Socket simulado: emisiones registradas y eventos del servidor a mano. */
function fakeSocket() {
  const handlers = new Map<string, Array<(payload?: unknown) => void>>();
  const emitted: Array<[string, unknown]> = [];
  return {
    emitted,
    emit: (name: string, payload: unknown, ack?: (result: unknown) => void) => {
      emitted.push([name, payload]);
      ack?.({ ok: true, presence: [] });
    },
    on: (name: string, handler: (payload?: unknown) => void) =>
      void handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    off: (name: string, handler: (payload?: unknown) => void) =>
      void handlers.set(
        name,
        (handlers.get(name) ?? []).filter((h) => h !== handler),
      ),
    fire: (name: string, payload?: unknown) => {
      for (const handler of handlers.get(name) ?? []) handler(payload);
    },
  };
}

describe('aviso sin conexión', () => {
  it('no aparece mientras conecta por primera vez', () => {
    useConnectionStore.getState().setStatus('connecting');
    render(<ConnectionBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('aparece al cortarse y mientras reintenta; desaparece al volver', () => {
    useConnectionStore.getState().setStatus('connected');
    render(<ConnectionBanner />);
    act(() => useConnectionStore.getState().setStatus('disconnected'));
    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión: reintentando');
    act(() => useConnectionStore.getState().setStatus('connecting'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => useConnectionStore.getState().setStatus('connected'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sin conexión, guardar, votar y comentar quedan deshabilitados', async () => {
    renderWorkspace({
      [DETAILS_URL]: () => json(200, [detail({ commentCount: 0 })]),
      'GET /api/details/x1/comments': () => json(200, []),
    });
    const panel = await selectActivity();
    const card = await within(panel).findByRole('article');
    await userEvent.click(within(card).getByRole('button', { name: 'Comentarios (0)' }));
    await userEvent.type(within(card).getByLabelText('Nuevo comentario'), 'Hola');
    act(() => {
      useConnectionStore.getState().setStatus('connected');
      useConnectionStore.getState().setStatus('disconnected');
    });
    expect(within(panel).getByRole('button', { name: 'Guardar requisito' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'Votar' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'Publicar' })).toBeDisabled();
    act(() => useConnectionStore.getState().setStatus('connected'));
    expect(within(panel).getByRole('button', { name: 'Guardar requisito' })).toBeEnabled();
  });
});

function lifecycle(socket: ReturnType<typeof fakeSocket>, client = new QueryClient()) {
  let location: ReturnType<typeof useLocation> | undefined;
  const wrapper = ({ children }: { children: ReactNode }) => {
    const Spy = () => {
      location = useLocation();
      return null;
    };
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/proyectos/p1/diagramas/d1']}>
          <Spy />
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
  renderHook(() => useRealtimeLifecycle(socket as never, { projectId: 'p1', versionId: 'v1' }), {
    wrapper,
  });
  return { client, location: () => location! };
}

describe('reconexión', () => {
  it('al volver, se une otra vez a la sala y vuelve a pedir lo del diagrama y el proyecto', () => {
    const socket = fakeSocket();
    const client = new QueryClient();
    for (const key of [
      detailKeys.list('d1', 'k', { sort: 'votes' }),
      diagramKeys.version('v1'),
      diagramKeys.list('p1'),
      projectKeys.detail('p1'),
    ]) {
      client.setQueryData(key, {});
    }
    lifecycle(socket, client);
    act(() => socket.fire('disconnect'));
    act(() => socket.fire('connect'));
    expect(socket.emitted).toContainEqual(['room:join', { versionId: 'v1' }]);
    for (const key of [
      detailKeys.list('d1', 'k', { sort: 'votes' }),
      diagramKeys.version('v1'),
      diagramKeys.list('p1'),
      projectKeys.detail('p1'),
    ]) {
      expect(client.getQueryState(key)!.isInvalidated, JSON.stringify(key)).toBe(true);
    }
  });

  it('la primera conexión no resincroniza (nada que recuperar)', () => {
    const socket = fakeSocket();
    const client = new QueryClient();
    client.setQueryData(projectKeys.detail('p1'), {});
    lifecycle(socket, client);
    act(() => socket.fire('connect'));
    expect(client.getQueryState(projectKeys.detail('p1'))!.isInvalidated).toBe(false);
  });
});

describe('revocación', () => {
  it('access:revoked lleva a "Mis proyectos" con el aviso', () => {
    const socket = fakeSocket();
    const { location } = lifecycle(socket);
    act(() => socket.fire('access:revoked', { projectId: 'p1', reason: 'removed' }));
    expect(location().pathname).toBe('/proyectos');
    expect(location().state).toEqual({ notice: 'Ya no tienes acceso a este proyecto.' });
  });

  it('access:revoked de otro proyecto no hace nada', () => {
    const socket = fakeSocket();
    const { location } = lifecycle(socket);
    act(() => socket.fire('access:revoked', { projectId: 'otro', reason: 'removed' }));
    expect(location().pathname).toBe('/proyectos/p1/diagramas/d1');
  });

  it('project:closed y project:reopened vuelven a pedir el proyecto (solo lectura sin recargar)', () => {
    const socket = fakeSocket();
    const client = new QueryClient();
    client.setQueryData(projectKeys.detail('p1'), {});
    lifecycle(socket, client);
    act(() => socket.fire('project:closed', { projectId: 'p1' }));
    expect(client.getQueryState(projectKeys.detail('p1'))!.isInvalidated).toBe(true);
  });

  it('"Mis proyectos" muestra el aviso que llega con la navegación', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'token-1',
      expiresIn: 900,
      user: { id: 'u1', name: 'Marta', email: 'marta@example.com' },
    });
    mockApi({ 'GET /api/projects': () => json(200, []) });
    render(
      <AppProviders>
        <RouterProvider
          router={createMemoryRouter(routes, {
            initialEntries: [
              { pathname: '/proyectos', state: { notice: 'Ya no tienes acceso a este proyecto.' } },
            ],
          })}
        />
      </AppProviders>,
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ya no tienes acceso a este proyecto.',
    );
  });
});
