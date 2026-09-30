import type { BBox } from '@reqcanvas/shared';
import type { Point, Size } from '../workspace/camera/zoom';

/**
 * Geometría del editor de zonas, en funciones puras. Las zonas se guardan normalizadas (0–1)
 * respecto a la imagen display (research R6); la interacción trabaja en píxeles de imagen.
 */

/** Lado mínimo de una zona: un arrastre más corto se trata como un clic. */
export const MIN_SIDE_PX = 8;

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Handle = (typeof HANDLES)[number];

type Edges = { left: number; top: number; right: number; bottom: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function toPixels(box: BBox, image: Size) {
  return {
    x: box.x * image.width,
    y: box.y * image.height,
    width: box.w * image.width,
    height: box.h * image.height,
  };
}

const edgesOf = (box: BBox, image: Size): Edges => {
  const { x, y, width, height } = toPixels(box, image);
  return { left: x, top: y, right: x + width, bottom: y + height };
};

const fromEdges = ({ left, top, right, bottom }: Edges, image: Size): BBox => ({
  x: left / image.width,
  y: top / image.height,
  w: (right - left) / image.width,
  h: (bottom - top) / image.height,
});

/** Zona dibujada arrastrando de `start` a `end`; `null` si es demasiado pequeña. */
export function boxFromDrag(start: Point, end: Point, image: Size): BBox | null {
  const left = clamp(Math.min(start.x, end.x), 0, image.width);
  const right = clamp(Math.max(start.x, end.x), 0, image.width);
  const top = clamp(Math.min(start.y, end.y), 0, image.height);
  const bottom = clamp(Math.max(start.y, end.y), 0, image.height);
  if (right - left < MIN_SIDE_PX || bottom - top < MIN_SIDE_PX) return null;
  return fromEdges({ left, top, right, bottom }, image);
}

/** Desplaza la zona `delta` píxeles sin sacarla de la imagen ni cambiar su tamaño. */
export function moveBox(box: BBox, delta: Point, image: Size): BBox {
  const { x, y, width, height } = toPixels(box, image);
  const left = clamp(x + delta.x, 0, image.width - width);
  const top = clamp(y + delta.y, 0, image.height - height);
  return fromEdges({ left, top, right: left + width, bottom: top + height }, image);
}

/**
 * Lleva los bordes del `handle` al puntero. Un borde no cruza el opuesto (la zona se queda en
 * el tamaño mínimo) ni sale de la imagen.
 */
export function resizeBox(box: BBox, handle: Handle, point: Point, image: Size): BBox {
  const edges = edgesOf(box, image);
  if (handle.includes('w')) {
    edges.left = clamp(point.x, 0, edges.right - MIN_SIDE_PX);
  }
  if (handle.includes('e')) {
    edges.right = clamp(point.x, edges.left + MIN_SIDE_PX, image.width);
  }
  if (handle.includes('n')) {
    edges.top = clamp(point.y, 0, edges.bottom - MIN_SIDE_PX);
  }
  if (handle.includes('s')) {
    edges.bottom = clamp(point.y, edges.top + MIN_SIDE_PX, image.height);
  }
  return fromEdges(edges, image);
}

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export const isArrowKey = (key: string) => key in ARROWS;

/** Flechas: 1 px; con `Shift`, 10 px (contracts/canvas-ui.md). */
export function nudgeBox(box: BBox, key: string, shift: boolean, image: Size): BBox {
  const direction = ARROWS[key];
  if (!direction) return box;
  const step = shift ? 10 : 1;
  return moveBox(box, { x: direction.x * step, y: direction.y * step }, image);
}

/** Tolerancia de los handles, en píxeles de pantalla. */
export const HANDLE_TOLERANCE_PX = 8;

export type Hit =
  { kind: 'handle'; key: string; handle: Handle } | { kind: 'zone'; key: string } | null;

function handlePoints(box: BBox, image: Size): Record<Handle, Point> {
  const { left, top, right, bottom } = edgesOf(box, image);
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  return {
    nw: { x: left, y: top },
    n: { x: midX, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: midY },
    se: { x: right, y: bottom },
    s: { x: midX, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: midY },
  };
}

/**
 * Qué hay bajo el puntero (en px de imagen): primero los handles de la zona seleccionada;
 * después, la zona más pequeña que lo contiene (edge case de zonas superpuestas, research R5).
 */
export function hitTest(
  zones: Array<{ key: string; bbox: BBox }>,
  point: Point,
  selectedKey: string | null,
  zoom: number,
  image: Size,
): Hit {
  const selected = zones.find((zone) => zone.key === selectedKey);
  if (selected) {
    const tolerance = HANDLE_TOLERANCE_PX / zoom;
    for (const [handle, at] of Object.entries(handlePoints(selected.bbox, image))) {
      if (Math.abs(at.x - point.x) <= tolerance && Math.abs(at.y - point.y) <= tolerance) {
        return { kind: 'handle', key: selected.key, handle: handle as Handle };
      }
    }
  }
  const containing = zones
    .filter((zone) => {
      const { left, top, right, bottom } = edgesOf(zone.bbox, image);
      return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
    })
    .sort((a, b) => a.bbox.w * a.bbox.h - b.bbox.w * b.bbox.h);
  return containing[0] ? { kind: 'zone', key: containing[0].key } : null;
}

/** Punto del borde de `box` en la dirección `(dx, dy)` desde su centro. */
function borderPoint(box: BBox, dx: number, dy: number, image: Size): Point {
  const { x, y, width, height } = toPixels(box, image);
  const center = { x: x + width / 2, y: y + height / 2 };
  if (dx === 0 && dy === 0) return center;
  const scale = Math.min(
    dx === 0 ? Infinity : width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : height / 2 / Math.abs(dy),
  );
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/** Flecha de una transición: de borde a borde, en la línea que une los centros. */
export function arrowBetween(from: BBox, to: BBox, image: Size): { start: Point; end: Point } {
  const a = toPixels(from, image);
  const b = toPixels(to, image);
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  return { start: borderPoint(from, dx, dy, image), end: borderPoint(to, -dx, -dy, image) };
}
