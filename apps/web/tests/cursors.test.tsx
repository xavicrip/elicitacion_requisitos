import type { PresenceEntry } from '@reqcanvas/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageToScreen, type Camera } from '../src/features/diagrams/workspace/camera/zoom';
import { useWorkspaceStore } from '../src/features/diagrams/workspace/store';
import {
  createThrottle,
  CursorsLayer,
  CursorsToggle,
  STALE_MS,
  useCursorPreference,
} from '../src/features/realtime/CursorsLayer';

// US3 de la 005 (FR-005; research R6): cursores en coordenadas de imagen, interpolados, que se
// ocultan sin novedades y que cada persona puede ocultar.

const image = { width: 2000, height: 1000 };
const viewport = { width: 800, height: 600 };
const luis: PresenceEntry = {
  userId: 'u3',
  name: 'Luis',
  color: '#B91C1C',
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

function renderLayer(socket = fakeSocket()) {
  const view = render(
    <div data-testid="surface">
      <CursorsLayer
        socket={socket as never}
        versionId="v1"
        joined
        image={image}
        presence={[luis]}
      />
    </div>,
  );
  return { socket, ...view };
}

/** Avanza `ms` de reloj y de fotogramas (un fotograma cada 16 ms). */
function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

function position(element: HTMLElement) {
  const match = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(element.style.transform);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

function setCamera(camera: Camera) {
  act(() => useWorkspaceStore.getState().setCamera(camera));
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  localStorage.clear();
  useCursorPreference.setState({ hidden: false });
  useWorkspaceStore.getState().reset();
  useWorkspaceStore.getState().setViewport(viewport);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('cursores ajenos', () => {
  it('un punto de la imagen queda en su sitio con cámaras distintas', () => {
    const camera = { zoom: 2, center: { x: 600, y: 300 } };
    setCamera(camera);
    const { socket } = renderLayer();
    act(() => socket.fire('cursor:moved', { userId: 'u3', x: 640, y: 320 }));
    advance(32);
    const cursor = screen.getByTestId('remote-cursor');
    expect(cursor).toHaveTextContent('Luis');
    expect(position(cursor)).toEqual(imageToScreen({ x: 640, y: 320 }, camera, viewport));

    // Otra cámara (el zoom de otra persona, o este cliente tras hacer zoom): mismo punto.
    const zoomedOut = { zoom: 0.5, center: { x: 1000, y: 500 } };
    setCamera(zoomedOut);
    advance(32);
    expect(position(cursor)).toEqual(imageToScreen({ x: 640, y: 320 }, zoomedOut, viewport));
  });

  it('el movimiento se interpola entre posiciones', () => {
    setCamera({ zoom: 1, center: { x: 400, y: 300 } });
    const { socket } = renderLayer();
    act(() => socket.fire('cursor:moved', { userId: 'u3', x: 100, y: 100 }));
    advance(32);
    const cursor = screen.getByTestId('remote-cursor');
    expect(position(cursor)).toEqual({ x: 100, y: 100 });
    act(() => socket.fire('cursor:moved', { userId: 'u3', x: 300, y: 100 }));
    advance(16);
    const midway = position(cursor)!;
    expect(midway.x).toBeGreaterThan(100);
    expect(midway.x).toBeLessThan(300);
    advance(1000);
    expect(position(cursor)!.x).toBeCloseTo(300, 1);
  });

  it('sin novedades en 5 s se oculta', () => {
    const { socket } = renderLayer();
    act(() => socket.fire('cursor:moved', { userId: 'u3', x: 10, y: 10 }));
    advance(STALE_MS - 500);
    expect(screen.getByTestId('remote-cursor')).toBeInTheDocument();
    advance(1000);
    expect(screen.queryByTestId('remote-cursor')).toBeNull();
  });
});

describe('envío del cursor propio', () => {
  it('se limita a uno cada 50 ms y envía la última posición de la ráfaga', () => {
    setCamera({ zoom: 1, center: { x: 400, y: 300 } });
    const { socket } = renderLayer();
    const surface = screen.getByTestId('surface');
    for (let i = 0; i < 10; i++) {
      fireEvent.pointerMove(surface, { clientX: 100 + i, clientY: 50 });
      advance(4);
    }
    const sent = () => socket.emitted.filter(([name]) => name === 'cursor:move');
    expect(sent()).toHaveLength(1);
    advance(50);
    expect(sent()).toHaveLength(2);
    // Coordenadas de imagen: con zoom 1 y centro (400, 300), pantalla = imagen.
    expect(sent()[0]![1]).toEqual({ versionId: 'v1', x: 100, y: 50 });
    expect(sent()[1]![1]).toEqual({ versionId: 'v1', x: 109, y: 50 });
  });

  it('convierte con la cámara de este cliente y no envía fuera de la imagen', () => {
    setCamera({ zoom: 2, center: { x: 500, y: 400 } });
    const { socket } = renderLayer();
    const surface = screen.getByTestId('surface');
    fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
    expect(socket.emitted).toEqual([['cursor:move', { versionId: 'v1', x: 500, y: 400 }]]);
    advance(100);
    setCamera({ zoom: 1, center: { x: 0, y: 0 } });
    fireEvent.pointerMove(surface, { clientX: 10, clientY: 10 });
    advance(100);
    expect(socket.emitted).toHaveLength(1);
  });

  it('createThrottle no envía nada tras cancel', () => {
    const send = vi.fn();
    const throttle = createThrottle(send, 50);
    throttle.push(1);
    throttle.push(2);
    throttle.cancel();
    advance(100);
    expect(send.mock.calls).toEqual([[1]]);
  });
});

describe('Ocultar cursores', () => {
  it('oculta los ajenos y se recuerda en localStorage', async () => {
    vi.useRealTimers();
    const { socket } = renderLayer();
    render(<CursorsToggle />);
    act(() => socket.fire('cursor:moved', { userId: 'u3', x: 10, y: 10 }));
    expect(screen.getByTestId('remote-cursor')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar cursores' }));
    expect(screen.queryByTestId('remote-cursor')).toBeNull();
    expect(localStorage.getItem('reqcanvas:hide-cursors')).toBe('true');
    expect(screen.getByRole('button', { name: 'Mostrar cursores' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('funciona aunque localStorage lance', async () => {
    vi.useRealTimers();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    render(<CursorsToggle />);
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar cursores' }));
    expect(useCursorPreference.getState().hidden).toBe(true);
  });
});
