import { describe, expect, it } from 'vitest';
import {
  HANDLES,
  MIN_SIDE_PX,
  boxFromDrag,
  moveBox,
  nudgeBox,
  resizeBox,
  toPixels,
} from '../src/features/diagrams/editor/geometry';

const image = { width: 1000, height: 500 };
const box = { x: 0.2, y: 0.2, w: 0.2, h: 0.4 }; // 200,100 → 400,300 px

const expectBox = (actual: Record<string, number>, expected: Record<string, number>) => {
  for (const [key, value] of Object.entries(expected)) expect(actual[key]).toBeCloseTo(value, 6);
};

describe('dibujar una zona (arrastre sobre un área vacía)', () => {
  it('normaliza el rectángulo arrastrado en cualquier dirección', () => {
    expectBox(boxFromDrag({ x: 300, y: 400 }, { x: 100, y: 100 }, image)!, {
      x: 0.1,
      y: 0.2,
      w: 0.2,
      h: 0.6,
    });
  });

  it('lo recorta a los bordes de la imagen', () => {
    expectBox(boxFromDrag({ x: -50, y: -20 }, { x: 100, y: 600 }, image)!, {
      x: 0,
      y: 0,
      w: 0.1,
      h: 1,
    });
  });

  it(`un arrastre de menos de ${MIN_SIDE_PX} px no crea zona (un clic)`, () => {
    expect(boxFromDrag({ x: 10, y: 10 }, { x: 13, y: 40 }, image)).toBeNull();
  });
});

describe('mover', () => {
  it('desplaza la zona en píxeles de imagen', () => {
    expectBox(moveBox(box, { x: 50, y: -50 }, image), { x: 0.25, y: 0.1, w: 0.2, h: 0.4 });
  });

  it('no la deja salir de la imagen y conserva su tamaño', () => {
    expectBox(moveBox(box, { x: 5000, y: -5000 }, image), { x: 0.8, y: 0, w: 0.2, h: 0.4 });
  });
});

describe('redimensionar con los 8 handles', () => {
  it('hay 8 handles', () => {
    expect(HANDLES).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  });

  it.each([
    ['se', { x: 500, y: 400 }, { x: 0.2, y: 0.2, w: 0.3, h: 0.6 }],
    ['nw', { x: 100, y: 50 }, { x: 0.1, y: 0.1, w: 0.3, h: 0.5 }],
    ['n', { x: 999, y: 50 }, { x: 0.2, y: 0.1, w: 0.2, h: 0.5 }],
    ['e', { x: 700, y: 999 }, { x: 0.2, y: 0.2, w: 0.5, h: 0.4 }],
    ['s', { x: 0, y: 450 }, { x: 0.2, y: 0.2, w: 0.2, h: 0.7 }],
    ['w', { x: 150, y: 0 }, { x: 0.15, y: 0.2, w: 0.25, h: 0.4 }],
    ['ne', { x: 600, y: 0 }, { x: 0.2, y: 0, w: 0.4, h: 0.6 }],
    ['sw', { x: 0, y: 500 }, { x: 0, y: 0.2, w: 0.4, h: 0.8 }],
  ] as const)('%s lleva el borde correspondiente al puntero', (handle, point, expected) => {
    expectBox(resizeBox(box, handle, point, image), expected);
  });

  it('cruzar el borde opuesto no invierte la zona: se queda en el tamaño mínimo', () => {
    const result = toPixels(resizeBox(box, 'e', { x: 0, y: 0 }, image), image);
    expect(result.x).toBeCloseTo(200);
    expect(result.width).toBeCloseTo(MIN_SIDE_PX);
  });

  it('no sale de la imagen', () => {
    expectBox(resizeBox(box, 'se', { x: 5000, y: 5000 }, image), { w: 0.8, h: 0.8 });
  });
});

describe('teclado', () => {
  it('flechas: 1 px; con Shift: 10 px', () => {
    expectBox(nudgeBox(box, 'ArrowRight', false, image), { x: 0.201 });
    expectBox(nudgeBox(box, 'ArrowDown', true, image), { y: 0.22 });
    expectBox(nudgeBox(box, 'ArrowLeft', true, image), { x: 0.19 });
    expectBox(nudgeBox(box, 'ArrowUp', false, image), { y: 0.198 });
  });

  it('tampoco sale de la imagen', () => {
    const corner = { x: 0, y: 0, w: 0.1, h: 0.1 };
    expectBox(nudgeBox(corner, 'ArrowLeft', true, image), { x: 0 });
  });
});

it('toPixels convierte a píxeles de imagen', () => {
  expect(toPixels(box, image)).toEqual({ x: 200, y: 100, width: 200, height: 200 });
});
