import { describe, expect, it } from 'vitest';
import {
  applyCameraCommand,
  centerOn,
  clampPan,
  clampZoom,
  fitCamera,
  fitZoom,
  imageToScreen,
  screenToImage,
  viewportRect,
  zoomAt,
  type Camera,
} from '../src/features/diagrams/workspace/camera/zoom';

const expectRect = (actual: Record<string, number>, expected: Record<string, number>) => {
  for (const [key, value] of Object.entries(expected)) expect(actual[key]).toBeCloseTo(value);
};

const viewport = { width: 1000, height: 500 };
const image = { width: 4000, height: 3000 };

describe('fitZoom y límites (FR-009: 10 %–800 % del ajuste)', () => {
  it('ajusta la imagen entera al lado más restrictivo', () => {
    expect(fitZoom(viewport, image)).toBeCloseTo(500 / 3000);
    expect(fitZoom({ width: 800, height: 1200 }, { width: 900, height: 1200 })).toBeCloseTo(
      800 / 900,
    );
  });

  it('fitCamera centra la imagen con el zoom de ajuste', () => {
    expect(fitCamera(viewport, image)).toEqual({
      zoom: fitZoom(viewport, image),
      center: { x: 2000, y: 1500 },
    });
  });

  it('limita el zoom al 10 %–800 % del ajuste', () => {
    const fit = fitZoom(viewport, image);
    expect(clampZoom(fit * 0.01, fit)).toBeCloseTo(fit * 0.1);
    expect(clampZoom(fit * 20, fit)).toBeCloseTo(fit * 8);
    expect(clampZoom(fit * 2, fit)).toBeCloseTo(fit * 2);
  });
});

describe('conversión de coordenadas', () => {
  const camera: Camera = { zoom: 0.5, center: { x: 2000, y: 1500 } };

  it('el centro del viewport es el centro de la cámara', () => {
    expect(screenToImage({ x: 500, y: 250 }, camera, viewport)).toEqual({ x: 2000, y: 1500 });
  });

  it('screenToImage e imageToScreen son inversas', () => {
    const point = { x: 123.5, y: 456.25 };
    const back = imageToScreen(screenToImage(point, camera, viewport), camera, viewport);
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
    expect(imageToScreen({ x: 0, y: 0 }, camera, viewport)).toEqual({ x: -500, y: -500 });
  });
});

describe('desplazamiento', () => {
  it('clampPan mantiene el centro dentro de la imagen (nunca se pierde de vista)', () => {
    expect(clampPan({ x: -50, y: 3500 }, image)).toEqual({ x: 0, y: 3000 });
    expect(clampPan({ x: 10, y: 20 }, image)).toEqual({ x: 10, y: 20 });
  });

  it('centerOn centra la cámara en un punto de la imagen sin cambiar el zoom', () => {
    const camera: Camera = { zoom: 2, center: { x: 0, y: 0 } };
    expect(centerOn(camera, { x: 1200, y: 9000 }, image)).toEqual({
      zoom: 2,
      center: { x: 1200, y: 3000 },
    });
  });

  it('zoomAt mantiene fijo el punto bajo el cursor', () => {
    const fit = fitZoom(viewport, image);
    const camera = fitCamera(viewport, image);
    const cursor = { x: 800, y: 100 };
    const before = screenToImage(cursor, camera, viewport);
    const zoomed = zoomAt(camera, 2, cursor, viewport, image, fit);
    expect(zoomed.zoom).toBeCloseTo(camera.zoom * 2);
    const after = screenToImage(cursor, zoomed, viewport);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('zoomAt respeta los límites de zoom', () => {
    const fit = fitZoom(viewport, image);
    const camera = fitCamera(viewport, image);
    expect(zoomAt(camera, 1000, { x: 500, y: 250 }, viewport, image, fit).zoom).toBeCloseTo(
      fit * 8,
    );
  });
});

describe('minimapa', () => {
  it('con el ajuste, el rectángulo del viewport cubre toda la altura de la imagen', () => {
    expectRect(viewportRect(fitCamera(viewport, image), viewport, image), {
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });

  it('con zoom, es un rectángulo normalizado (0–1) alrededor del centro', () => {
    const rect = viewportRect({ zoom: 1, center: { x: 2000, y: 1500 } }, viewport, image);
    expectRect(rect, { x: 1500 / 4000, y: 1250 / 3000, w: 1000 / 4000, h: 500 / 3000 });
  });

  it('se recorta a los bordes de la imagen', () => {
    const rect = viewportRect({ zoom: 1, center: { x: 0, y: 0 } }, viewport, image);
    expectRect(rect, { x: 0, y: 0, w: 500 / 4000, h: 250 / 3000 });
  });
});

describe('applyCameraCommand (teclado, minimapa y lista accesible)', () => {
  const fit = fitZoom(viewport, image);
  const camera: Camera = { zoom: fit * 2, center: { x: 1000, y: 1000 } };

  it('fit vuelve a "ajustar a pantalla"', () => {
    expect(applyCameraCommand(camera, { type: 'fit' }, viewport, image)).toEqual(
      fitCamera(viewport, image),
    );
  });

  it('zoom multiplica el zoom en el centro del viewport, dentro de los límites', () => {
    const zoomed = applyCameraCommand(camera, { type: 'zoom', factor: 1.25 }, viewport, image);
    expect(zoomed.zoom).toBeCloseTo(fit * 2.5);
    expect(zoomed.center.x).toBeCloseTo(1000);
    expect(
      applyCameraCommand(camera, { type: 'zoom', factor: 100 }, viewport, image).zoom,
    ).toBeCloseTo(fit * 8);
  });

  it('pan desplaza en píxeles de pantalla', () => {
    const moved = applyCameraCommand(camera, { type: 'pan', dx: 100, dy: -50 }, viewport, image);
    expect(moved.center.x).toBeCloseTo(1000 + 100 / camera.zoom);
    expect(moved.center.y).toBeCloseTo(1000 - 50 / camera.zoom);
  });

  it('center centra en un punto de la imagen, sin salir de ella', () => {
    expect(
      applyCameraCommand(camera, { type: 'center', point: { x: 9999, y: 10 } }, viewport, image),
    ).toEqual({ zoom: camera.zoom, center: { x: 4000, y: 10 } });
  });
});
