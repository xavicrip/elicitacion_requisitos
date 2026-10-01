/**
 * Cámara del espacio de trabajo en funciones puras (research R4), probadas sin WebGL.
 * Coordenadas de imagen: píxeles de la imagen display, origen arriba a la izquierda, `y` hacia
 * abajo. Coordenadas de pantalla: píxeles CSS del viewport, con el mismo origen y sentido.
 */

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
/** `zoom`: píxeles de pantalla por píxel de imagen; `center`: punto de la imagen en el centro. */
export type Camera = { zoom: number; center: Point };
/** Rectángulo normalizado (0–1) respecto a la imagen. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Límites del zoom respecto al de "ajustar a pantalla" (FR-009: 10 %–800 %). */
export const MIN_ZOOM_FACTOR = 0.1;
export const MAX_ZOOM_FACTOR = 8;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Zoom con el que la imagen entera cabe en el viewport. */
export function fitZoom(viewport: Size, image: Size): number {
  return Math.min(viewport.width / image.width, viewport.height / image.height);
}

/** Cámara de "ajustar a pantalla": imagen centrada con el zoom de ajuste. */
export function fitCamera(viewport: Size, image: Size): Camera {
  return { zoom: fitZoom(viewport, image), center: { x: image.width / 2, y: image.height / 2 } };
}

export function clampZoom(zoom: number, fit: number): number {
  return clamp(zoom, fit * MIN_ZOOM_FACTOR, fit * MAX_ZOOM_FACTOR);
}

export function screenToImage(point: Point, camera: Camera, viewport: Size): Point {
  return {
    x: camera.center.x + (point.x - viewport.width / 2) / camera.zoom,
    y: camera.center.y + (point.y - viewport.height / 2) / camera.zoom,
  };
}

export function imageToScreen(point: Point, camera: Camera, viewport: Size): Point {
  return {
    x: (point.x - camera.center.x) * camera.zoom + viewport.width / 2,
    y: (point.y - camera.center.y) * camera.zoom + viewport.height / 2,
  };
}

/** El centro de la cámara no sale de la imagen: siempre queda parte de ella a la vista. */
export function clampPan(center: Point, image: Size): Point {
  return { x: clamp(center.x, 0, image.width), y: clamp(center.y, 0, image.height) };
}

/** Centra la cámara en un punto de la imagen (clic en el minimapa, foco en una actividad). */
export function centerOn(camera: Camera, point: Point, image: Size): Camera {
  return { zoom: camera.zoom, center: clampPan(point, image) };
}

/** Multiplica el zoom por `factor` manteniendo fijo el punto de pantalla `anchor` (cursor). */
export function zoomAt(
  camera: Camera,
  factor: number,
  anchor: Point,
  viewport: Size,
  image: Size,
  fit: number,
): Camera {
  const zoom = clampZoom(camera.zoom * factor, fit);
  const fixed = screenToImage(anchor, camera, viewport);
  const center = {
    x: fixed.x - (anchor.x - viewport.width / 2) / zoom,
    y: fixed.y - (anchor.y - viewport.height / 2) / zoom,
  };
  return { zoom, center: clampPan(center, image) };
}

/** Parte visible de la imagen, normalizada y recortada a sus bordes (rectángulo del minimapa). */
export function viewportRect(camera: Camera, viewport: Size, image: Size): Rect {
  const topLeft = screenToImage({ x: 0, y: 0 }, camera, viewport);
  const bottomRight = screenToImage({ x: viewport.width, y: viewport.height }, camera, viewport);
  const x0 = clamp(topLeft.x / image.width, 0, 1);
  const y0 = clamp(topLeft.y / image.height, 0, 1);
  const x1 = clamp(bottomRight.x / image.width, 0, 1);
  const y1 = clamp(bottomRight.y / image.height, 0, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Órdenes a la cámara desde fuera del canvas: teclado, minimapa y lista accesible. */
export type CameraCommand =
  | { type: 'fit' }
  | { type: 'zoom'; factor: number }
  /** Desplazamiento en píxeles de pantalla. */
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'center'; point: Point };

export function applyCameraCommand(
  camera: Camera,
  command: CameraCommand,
  viewport: Size,
  image: Size,
): Camera {
  switch (command.type) {
    case 'fit':
      return fitCamera(viewport, image);
    case 'zoom': {
      const middle = { x: viewport.width / 2, y: viewport.height / 2 };
      return zoomAt(camera, command.factor, middle, viewport, image, fitZoom(viewport, image));
    }
    case 'pan':
      return {
        zoom: camera.zoom,
        center: clampPan(
          {
            x: camera.center.x + command.dx / camera.zoom,
            y: camera.center.y + command.dy / camera.zoom,
          },
          image,
        ),
      };
    case 'center':
      return centerOn(camera, command.point, image);
  }
}
