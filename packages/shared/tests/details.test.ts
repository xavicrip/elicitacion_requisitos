import { describe, expect, it } from 'vitest';
import {
  ActivityCoverageSchema,
  CommentInputSchema,
  DetailInputSchema,
  DetailPatchSchema,
  DetailSchema,
  DetailStatusSchema,
  DetailTypeSchema,
  FacetsSchema,
  PrioritySchema,
  StatusChangeSchema,
  detailSummary,
  normalizeTag,
} from '../src/details';
import { contractSchema } from './contract';

const input = {
  given: 'el cliente tiene productos en el carrito',
  when: 'paga con tarjeta',
  then: 'el sistema confirma el pago en menos de 5 segundos',
  type: 'non_functional',
};

describe('enumeraciones del contrato de la 004', () => {
  it.each([
    ['DetailType', DetailTypeSchema.options],
    ['Priority', PrioritySchema.options],
    ['DetailStatus', DetailStatusSchema.options],
  ])('%s coincide con el contrato', (name, options) => {
    expect([...options].sort()).toEqual([...(contractSchema(name, '004').enum ?? [])].sort());
  });
});

describe('DetailInput (FR-002, FR-003)', () => {
  it('acepta un escenario completo y recorta los textos', () => {
    expect(DetailInputSchema.parse({ ...input, given: `  ${input.given}  ` })).toEqual({
      ...input,
      priority: null,
      authorRole: null,
      tags: [],
    });
  });

  it.each([
    ['given', 'Dado'],
    ['when', 'Cuando'],
    ['then', 'Entonces'],
  ])('%s vacío o con menos de 5 caracteres → error en ese campo que nombra «%s»', (field, name) => {
    const result = DetailInputSchema.safeParse({ ...input, [field]: '   ' });
    expect(result.success).toBe(false);
    const issue = result.error!.issues[0]!;
    expect(issue.path).toEqual([field]);
    expect(issue.message).toContain(name);
    expect(DetailInputSchema.safeParse({ ...input, [field]: 'abcd' }).success).toBe(false);
  });

  it('cada componente admite hasta 1 000 caracteres', () => {
    expect(DetailInputSchema.safeParse({ ...input, then: 'x'.repeat(1000) }).success).toBe(true);
    expect(DetailInputSchema.safeParse({ ...input, then: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('el tipo es obligatorio; la prioridad, opcional y MoSCoW', () => {
    const { type: _type, ...withoutType } = input;
    expect(DetailInputSchema.safeParse(withoutType).success).toBe(false);
    expect(DetailInputSchema.parse({ ...input, priority: 'must' }).priority).toBe('must');
    expect(DetailInputSchema.safeParse({ ...input, priority: 'urgente' }).success).toBe(false);
  });

  it('el rol admite hasta 60 caracteres y vacío equivale a sin rol', () => {
    expect(DetailInputSchema.parse({ ...input, authorRole: '  Cajero ' }).authorRole).toBe(
      'Cajero',
    );
    expect(DetailInputSchema.parse({ ...input, authorRole: '  ' }).authorRole).toBeNull();
    expect(DetailInputSchema.safeParse({ ...input, authorRole: 'x'.repeat(61) }).success).toBe(
      false,
    );
  });

  it('las etiquetas se normalizan, sin duplicados, hasta 10 de ≤ 30 caracteres', () => {
    expect(
      DetailInputSchema.parse({ ...input, tags: [' Pagos ', 'pagos', 'Tarjeta  de crédito'] }).tags,
    ).toEqual(['pagos', 'tarjeta de crédito']);
    expect(
      DetailInputSchema.safeParse({ ...input, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })
        .success,
    ).toBe(false);
    expect(DetailInputSchema.safeParse({ ...input, tags: ['x'.repeat(31)] }).success).toBe(false);
  });

  it('normalizeTag: minúsculas y espacios simples', () => {
    expect(normalizeTag('  Regla   DE  Negocio ')).toBe('regla de negocio');
  });

  it('coincide con los límites del contrato', () => {
    const { properties } = contractSchema('DetailInput', '004');
    expect(properties?.given).toMatchObject({ minLength: 5, maxLength: 1000 });
    expect(properties?.authorRole).toMatchObject({ maxLength: 60 });
    expect(properties?.tags).toMatchObject({ maxItems: 10, items: { maxLength: 30 } });
  });
});

describe('DetailPatch', () => {
  it('acepta cambios parciales y exige al menos un campo', () => {
    expect(DetailPatchSchema.parse({ then: 'responde en 3 segundos' })).toEqual({
      then: 'responde en 3 segundos',
    });
    expect(DetailPatchSchema.safeParse({}).success).toBe(false);
  });
});

describe('StatusChange (FR-010)', () => {
  it('pendiente y validado no llevan datos extra', () => {
    expect(StatusChangeSchema.parse({ status: 'validated' })).toEqual({ status: 'validated' });
  });

  it('duplicado exige el original; descartado, un motivo de hasta 500 caracteres', () => {
    expect(StatusChangeSchema.safeParse({ status: 'duplicate' }).success).toBe(false);
    expect(StatusChangeSchema.parse({ status: 'duplicate', duplicateOf: 'd2' })).toEqual({
      status: 'duplicate',
      duplicateOf: 'd2',
    });
    expect(StatusChangeSchema.safeParse({ status: 'discarded', discardReason: ' ' }).success).toBe(
      false,
    );
    expect(
      StatusChangeSchema.safeParse({ status: 'discarded', discardReason: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(
      StatusChangeSchema.parse({ status: 'discarded', discardReason: ' Fuera de alcance ' }),
    ).toEqual({ status: 'discarded', discardReason: 'Fuera de alcance' });
  });
});

describe('respuestas', () => {
  it('Detail incluye autor, estado, contadores, rev y permisos', () => {
    const detail = {
      id: 'd1',
      diagramId: 'g1',
      activityKey: '0b1f5c7e-7d9a-4c0e-9d6c-2f1e3a4b5c6d',
      ...input,
      priority: null,
      authorRole: null,
      tags: [],
      status: 'pending',
      duplicateOf: null,
      discardReason: null,
      voteCount: 0,
      votedByMe: false,
      commentCount: 0,
      author: { id: 'u1', name: 'Luis' },
      rev: 0,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
      permissions: { canEdit: true, canDelete: true, canVote: false, canModerate: false },
    };
    expect(DetailSchema.parse(detail)).toEqual(detail);
    const required = contractSchema('Detail', '004') as unknown as {
      allOf: Array<{ required?: string[] }>;
    };
    for (const field of required.allOf.flatMap((part) => part.required ?? [])) {
      expect(detail).toHaveProperty(field);
    }
  });

  it('ActivityCoverage y facets', () => {
    expect(
      ActivityCoverageSchema.safeParse({
        activityKey: 'k1',
        total: 2,
        byStatus: { pending: 1, validated: 1, duplicate: 0, discarded: 0 },
        effectiveVotes: 3,
        top: [{ id: 'd1', summary: 'Cuando paga → Entonces confirma' }],
      }).success,
    ).toBe(true);
    expect(
      FacetsSchema.safeParse({ roles: [{ value: 'Cajero', count: 2 }], tags: [] }).success,
    ).toBe(true);
  });

  it('un comentario tiene de 1 a 1 000 caracteres', () => {
    expect(CommentInputSchema.parse({ text: ' ¿Aplica a PayPal? ' })).toEqual({
      text: '¿Aplica a PayPal?',
    });
    expect(CommentInputSchema.safeParse({ text: '  ' }).success).toBe(false);
    expect(CommentInputSchema.safeParse({ text: 'x'.repeat(1001) }).success).toBe(false);
  });
});

describe('detailSummary (notas del canvas, research R8)', () => {
  it('«Cuando … → Entonces …», truncado a 80 caracteres con «…»', () => {
    expect(detailSummary({ when: 'paga', then: 'confirma' })).toBe(
      'Cuando paga → Entonces confirma',
    );
    const long = detailSummary({ when: 'x'.repeat(60), then: 'y'.repeat(60) });
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });
});
