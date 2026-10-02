import type { PresenceEntry } from '@reqcanvas/shared';
import { act, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../src/features/diagrams/workspace/store';
import { PresenceBar } from '../src/features/realtime/PresenceBar';
import { presenceBadge, usePresence } from '../src/features/realtime/usePresence';
import { activity } from './helpers/details';

// US2 de la 005 (FR-003, FR-004): quién está conectado y qué actividad tiene seleccionada.

const ana: PresenceEntry = {
  userId: 'u2',
  name: 'Ana',
  color: '#1D4ED8',
  selectedActivityKey: null,
};
const luis: PresenceEntry = {
  userId: 'u3',
  name: 'Luis',
  color: '#B91C1C',
  selectedActivityKey: null,
};
const me: PresenceEntry = {
  userId: 'u1',
  name: 'Marta',
  color: '#15803D',
  selectedActivityKey: null,
};

/** Socket simulado: emisiones registradas y eventos del servidor a mano. */
function fakeSocket() {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  const emitted: Array<[string, unknown]> = [];
  return {
    emitted,
    emit: (name: string, payload: unknown) => void emitted.push([name, payload]),
    on: (name: string, handler: (payload: unknown) => void) =>
      void handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    off: (name: string, handler: (payload: unknown) => void) =>
      void handlers.set(
        name,
        (handlers.get(name) ?? []).filter((h) => h !== handler),
      ),
    fire: (name: string, payload: unknown) => {
      for (const handler of handlers.get(name) ?? []) handler(payload);
    },
  };
}

beforeEach(() => useWorkspaceStore.getState().reset());
afterEach(() => vi.useRealTimers());

describe('usePresence', () => {
  it('parte del estado del ack y se actualiza con presence:update', () => {
    const socket = fakeSocket();
    const { result } = renderHook(() => usePresence(socket as never, 'v1', [me, ana], true));
    expect(result.current).toEqual([me, ana]);
    act(() => socket.fire('presence:update', { entries: [me, ana, luis] }));
    expect(result.current).toEqual([me, ana, luis]);
  });

  it('late cada 5 s mientras está en la sala', () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const { unmount } = renderHook(() => usePresence(socket as never, 'v1', [me], true));
    act(() => vi.advanceTimersByTime(10_000));
    expect(socket.emitted.filter(([name]) => name === 'presence:heartbeat')).toEqual([
      ['presence:heartbeat', { versionId: 'v1' }],
      ['presence:heartbeat', { versionId: 'v1' }],
    ]);
    unmount();
    act(() => vi.advanceTimersByTime(10_000));
    expect(socket.emitted.filter(([name]) => name === 'presence:heartbeat')).toHaveLength(2);
  });

  it('envía la actividad seleccionada (useWorkspaceEvents de la 003)', () => {
    const socket = fakeSocket();
    renderHook(() => usePresence(socket as never, 'v1', [me], true));
    act(() => useWorkspaceStore.getState().select(activity.key));
    act(() => useWorkspaceStore.getState().select(null));
    expect(socket.emitted.filter(([name]) => name === 'presence:select')).toEqual([
      ['presence:select', { versionId: 'v1', activityKey: activity.key }],
      ['presence:select', { versionId: 'v1', activityKey: null }],
    ]);
  });

  it('fuera de la sala no late ni envía la selección', () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    renderHook(() => usePresence(socket as never, 'v1', [], false));
    act(() => useWorkspaceStore.getState().select(activity.key));
    act(() => vi.advanceTimersByTime(10_000));
    expect(socket.emitted).toEqual([]);
  });
});

describe('PresenceBar', () => {
  it('lista a los demás con su nombre y color, sin el usuario actual', () => {
    render(<PresenceBar entries={[me, ana, luis]} userId="u1" />);
    const list = screen.getByRole('list', { name: 'Personas conectadas' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Ana', 'Luis']);
    expect(within(items[0]!).getByTestId('presence-color')).toHaveStyle({
      backgroundColor: '#1D4ED8',
    });
  });

  it('sin nadie más conectado lo dice', () => {
    render(<PresenceBar entries={[me]} userId="u1" />);
    expect(screen.getByText('Nadie más conectado')).toBeInTheDocument();
  });
});

describe('indicador de selección sobre la actividad', () => {
  it('muestra el color y el nombre de quien la tiene seleccionada, sin el usuario actual', () => {
    const badge = presenceBadge(
      [
        { ...ana, selectedActivityKey: activity.key },
        { ...me, selectedActivityKey: activity.key },
        { ...luis, selectedActivityKey: 'otra' },
      ],
      'u1',
    );
    render(<>{badge(activity)}</>);
    const marker = screen.getByLabelText('Ana tiene seleccionada esta actividad');
    expect(marker).toHaveStyle({ borderColor: '#1D4ED8' });
    expect(screen.queryByLabelText(/Luis|Marta/)).toBeNull();
  });

  it('sin nadie en la actividad no muestra nada', () => {
    const badge = presenceBadge([ana], 'u1');
    const { container } = render(<>{badge(activity)}</>);
    expect(container).toBeEmptyDOMElement();
  });
});
