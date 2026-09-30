import { describe, expect, it } from 'vitest';
import {
  ActivityInputSchema,
  ActivityPatchSchema,
  ActivitySchema,
  ActivityTypeSchema,
  BBoxSchema,
  DiagramInputSchema,
  DiagramSummarySchema,
  DiagramVersionSchema,
  VersionStatusSchema,
} from '../src/diagrams';
import { contractSchema } from './contract';

const bbox = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };

describe('enumeraciones del contrato de la 003', () => {
  it('ActivityType coincide con el contrato', () => {
    expect([...ActivityTypeSchema.options].sort()).toEqual(
      [...(contractSchema('ActivityType', '003').enum ?? [])].sort(),
    );
  });

  it('el estado de una versión coincide con el contrato', () => {
    const status = contractSchema('DiagramVersion', '003').properties?.status;
    expect([...VersionStatusSchema.options].sort()).toEqual([...(status?.enum ?? [])].sort());
  });
});

describe('BBox normalizada (data-model: coordenadas 0–1)', () => {
  it('acepta una caja dentro de la imagen, incluidos los bordes', () => {
    expect(BBoxSchema.safeParse(bbox).success).toBe(true);
    expect(BBoxSchema.safeParse({ x: 0, y: 0, w: 1, h: 1 }).success).toBe(true);
  });

  it('tolera el redondeo de coma flotante en el borde (x + w = 1)', () => {
    expect(BBoxSchema.safeParse({ x: 0.7, y: 0.9, w: 0.3, h: 0.1 }).success).toBe(true);
  });

  it.each([
    ['ancho cero', { ...bbox, w: 0 }],
    ['alto negativo', { ...bbox, h: -0.1 }],
    ['x negativa', { ...bbox, x: -0.01 }],
    ['se sale por la derecha', { ...bbox, x: 0.8, w: 0.3 }],
    ['se sale por abajo', { ...bbox, y: 0.95, h: 0.1 }],
    ['valores no finitos', { ...bbox, x: Number.NaN }],
  ])('rechaza %s', (_caso, value) => {
    expect(BBoxSchema.safeParse(value).success).toBe(false);
  });

  it('coincide con los límites del contrato', () => {
    const { properties } = contractSchema('BBox', '003');
    expect(properties?.x).toMatchObject({ minimum: 0, maximum: 1 });
    expect(properties?.w).toMatchObject({ exclusiveMinimum: 0, maximum: 1 });
  });
});

describe('ActivityInput (FR-004, FR-005)', () => {
  it('acepta nombre, tipo, caja y transiciones, y recorta el nombre', () => {
    expect(
      ActivityInputSchema.parse({ label: '  Validar pago ', type: 'decision', bbox, next: ['k2'] }),
    ).toEqual({ label: 'Validar pago', type: 'decision', bbox, next: ['k2'] });
  });

  it('next es opcional', () => {
    expect(ActivityInputSchema.parse({ label: 'A', type: 'action', bbox })).not.toHaveProperty(
      'next',
    );
  });

  it.each([
    ['sin nombre', { label: '  ' }],
    ['nombre de 121 caracteres', { label: 'a'.repeat(121) }],
    ['tipo desconocido', { type: 'subproceso' }],
    ['transiciones duplicadas', { next: ['k2', 'k2'] }],
  ])('rechaza %s', (_caso, override) => {
    expect(
      ActivityInputSchema.safeParse({ label: 'A', type: 'action', bbox, ...override }).success,
    ).toBe(false);
  });

  it('coincide con los límites del contrato', () => {
    expect(contractSchema('ActivityInput', '003').properties?.label).toMatchObject({
      minLength: 1,
      maxLength: 120,
    });
  });
});

describe('ActivityPatch', () => {
  it('acepta cambios parciales', () => {
    expect(ActivityPatchSchema.parse({ bbox })).toEqual({ bbox });
  });

  it('exige al menos un campo', () => {
    expect(ActivityPatchSchema.safeParse({}).success).toBe(false);
  });
});

describe('respuestas', () => {
  it('Activity incluye id, key (UUID), rev y source', () => {
    const activity = {
      id: 'a1',
      key: '0b1f5c7e-7d9a-4c0e-9d6c-2f1e3a4b5c6d',
      rev: 1,
      source: 'manual',
      label: 'Validar pago',
      type: 'action',
      bbox,
      next: [],
    };
    expect(ActivitySchema.parse(activity)).toEqual(activity);
    expect(ActivitySchema.safeParse({ ...activity, key: 'no-es-uuid' }).success).toBe(false);
  });

  it('DiagramSummary y DiagramVersion aceptan respuestas válidas', () => {
    expect(
      DiagramSummarySchema.safeParse({
        id: 'd1',
        name: 'Proceso de compra',
        order: 0,
        publishedVersionId: null,
        draftVersionId: 'v1',
        thumbUrl: '/api/diagram-versions/v1/image/thumb',
      }).success,
    ).toBe(true);
    expect(
      DiagramVersionSchema.safeParse({
        id: 'v1',
        diagramId: 'd1',
        number: 1,
        status: 'draft',
        image: {
          displayUrl: '/api/diagram-versions/v1/image/display',
          thumbUrl: '/api/diagram-versions/v1/image/thumb',
          width: 900,
          height: 1200,
        },
        publishedAt: null,
      }).success,
    ).toBe(true);
  });

  it('el nombre de un diagrama tiene 1–100 caracteres', () => {
    expect(DiagramInputSchema.parse({ name: ' Compra ' })).toEqual({ name: 'Compra' });
    expect(DiagramInputSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false);
  });
});
