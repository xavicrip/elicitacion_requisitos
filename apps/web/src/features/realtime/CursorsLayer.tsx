import type { CursorMoved, PresenceEntry } from '@reqcanvas/shared';
import { presenceColor } from '@reqcanvas/shared';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  imageToScreen,
  screenToImage,
  type Point,
  type Size,
} from '../diagrams/workspace/camera/zoom';
import { useWorkspaceStore } from '../diagrams/workspace/store';
import type { RealtimeSocket } from './socket';

/** Envío limitado a 20 por segundo (el límite del servidor, research R6). */
export const SEND_INTERVAL_MS = 50;
/** Un cursor sin novedades durante este tiempo se oculta. */
export const STALE_MS = 5_000;
/** Fracción del camino que recorre un cursor en cada fotograma hacia su última posición. */
const LERP = 0.35;
const PREFERENCE_KEY = 'reqcanvas:hide-cursors';

type Listener = { on(name: string, h: unknown): unknown; off(name: string, h: unknown): unknown };

function readPreference(): boolean {
  try {
    return localStorage.getItem(PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Preferencia "Ocultar cursores" (US3): se recuerda en el navegador. */
export const useCursorPreference = create<{ hidden: boolean; setHidden(hidden: boolean): void }>()(
  (set) => ({
    hidden: readPreference(),
    setHidden: (hidden) => {
      try {
        localStorage.setItem(PREFERENCE_KEY, String(hidden));
      } catch {
        // Navegación privada o almacenamiento lleno: vale para esta sesión.
      }
      set({ hidden });
    },
  }),
);

export function lerpPoint(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/**
 * Llama a `send` como mucho una vez cada `intervalMs`; el último valor de una ráfaga se envía al
 * terminar el intervalo, para que los demás vean dónde se detuvo el cursor.
 */
export function createThrottle<T>(send: (value: T) => void, intervalMs: number) {
  let last = -Infinity;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    if (!pending) return;
    last = Date.now();
    send(pending.value);
    pending = null;
  };
  return {
    push(value: T) {
      pending = { value };
      const wait = last + intervalMs - Date.now();
      if (wait <= 0) flush();
      else timer ??= setTimeout(flush, wait);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}

type Remote = { target: Point; current: Point; lastAt: number };

/** Botón "Ocultar cursores" / "Mostrar cursores". */
export function CursorsToggle() {
  const { hidden, setHidden } = useCursorPreference();
  return (
    <button
      type="button"
      aria-pressed={hidden}
      onClick={() => setHidden(!hidden)}
      className="rounded border px-2 py-1 text-sm"
    >
      {hidden ? 'Mostrar cursores' : 'Ocultar cursores'}
    </button>
  );
}

/**
 * Cursores en vivo (US3, FR-005; research R6). Capa HTML sobre el canvas: el puntero propio se
 * envía en coordenadas de imagen (cada cliente tiene su propio zoom) y los ajenos se colocan
 * con la cámara de este cliente, interpolando entre posiciones. Un bucle de
 * `requestAnimationFrame` mueve los elementos sin renderizar React en cada fotograma.
 */
export function CursorsLayer({
  socket,
  versionId,
  joined,
  image,
  presence,
}: {
  socket: RealtimeSocket | null;
  versionId: string | null;
  joined: boolean;
  image: Size;
  presence: PresenceEntry[];
}) {
  const layer = useRef<HTMLDivElement>(null);
  const hidden = useCursorPreference((state) => state.hidden);
  const [ids, setIds] = useState<string[]>([]);
  const remotes = useRef(new Map<string, Remote>());
  const elements = useRef(new Map<string, HTMLElement>());
  const frame = useRef<number | undefined>(undefined);

  // Puntero propio → `cursor:move`, dentro de la imagen y solo estando en la sala.
  useEffect(() => {
    const surface = layer.current?.parentElement;
    if (!socket || !versionId || !joined || !surface) return;
    const throttle = createThrottle(
      (point: Point) => socket.emit('cursor:move', { versionId, ...point }),
      SEND_INTERVAL_MS,
    );
    const onMove = (event: PointerEvent) => {
      const rect = surface.getBoundingClientRect();
      const { camera, viewport } = useWorkspaceStore.getState();
      const point = screenToImage(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        camera,
        viewport,
      );
      if (point.x < 0 || point.y < 0 || point.x > image.width || point.y > image.height) return;
      throttle.push({ x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 });
    };
    surface.addEventListener('pointermove', onMove);
    return () => {
      surface.removeEventListener('pointermove', onMove);
      throttle.cancel();
    };
  }, [socket, versionId, joined, image.width, image.height]);

  // Cursores ajenos: se olvidan al cambiar de versión.
  useEffect(() => {
    remotes.current.clear();
    setIds([]);
  }, [versionId]);

  useEffect(() => {
    if (!socket) return;
    const tick = () => {
      frame.current = undefined;
      const now = Date.now();
      const { camera, viewport } = useWorkspaceStore.getState();
      let gone = false;
      for (const [userId, remote] of remotes.current) {
        if (now - remote.lastAt > STALE_MS) {
          remotes.current.delete(userId);
          gone = true;
          continue;
        }
        remote.current = lerpPoint(remote.current, remote.target, LERP);
        const element = elements.current.get(userId);
        if (element) {
          const screen = imageToScreen(remote.current, camera, viewport);
          element.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
        }
      }
      if (gone) setIds([...remotes.current.keys()]);
      if (remotes.current.size > 0) frame.current = requestAnimationFrame(tick);
    };
    const handler = ({ userId, x, y }: CursorMoved) => {
      const target = { x, y };
      const remote = remotes.current.get(userId);
      if (remote) {
        remote.target = target;
        remote.lastAt = Date.now();
      } else {
        // El primero aparece donde está, sin deslizarse desde el origen.
        remotes.current.set(userId, { target, current: target, lastAt: Date.now() });
        setIds([...remotes.current.keys()]);
      }
      frame.current ??= requestAnimationFrame(tick);
    };
    (socket as unknown as Listener).on('cursor:moved', handler);
    return () => {
      (socket as unknown as Listener).off('cursor:moved', handler);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
  }, [socket]);

  const names = new Map(presence.map((entry) => [entry.userId, entry]));
  return (
    <div
      ref={layer}
      aria-hidden="true"
      data-testid="cursors-layer"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {!hidden &&
        ids.map((userId) => {
          const entry = names.get(userId);
          const color = entry?.color ?? presenceColor(userId);
          return (
            <div
              key={userId}
              data-testid="remote-cursor"
              data-user-id={userId}
              ref={(element) => {
                if (element) {
                  elements.current.set(userId, element);
                  const remote = remotes.current.get(userId);
                  if (remote) {
                    const { camera, viewport } = useWorkspaceStore.getState();
                    const screen = imageToScreen(remote.current, camera, viewport);
                    element.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
                  }
                } else {
                  elements.current.delete(userId);
                }
              }}
              className="absolute top-0 left-0 will-change-transform"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" className="-translate-x-px">
                <path
                  d="M0 0 L0 13 L4 9.5 L7 15 L9 14 L6 8.5 L11 8 Z"
                  fill={color}
                  stroke="white"
                />
              </svg>
              {entry && (
                <span
                  className="ml-3 rounded px-1 text-xs whitespace-nowrap text-white"
                  style={{ backgroundColor: color }}
                >
                  {entry.name}
                </span>
              )}
            </div>
          );
        })}
    </div>
  );
}
