import { describe, expect, it } from 'vitest';
import {
  InvitationCreatedSchema,
  InvitationPreviewSchema,
  InvitationSchema,
  InvitationStatusSchema,
  ProjectInputSchema,
  ProjectSchema,
  ProjectStatusSchema,
  ProjectSummarySchema,
  RoleChangeSchema,
  RoleSchema,
  StatusActionSchema,
  nextStatus,
} from '../src/projects';
import { contractSchema } from './contract';

describe('enumeraciones del contrato', () => {
  it.each([
    ['Role', RoleSchema.options],
    ['ProjectStatus', ProjectStatusSchema.options],
  ])('%s coincide con el contrato', (name, options) => {
    expect([...options].sort()).toEqual([...(contractSchema(name).enum ?? [])].sort());
  });

  it('el estado de una invitación coincide con el contrato', () => {
    const status = contractSchema('Invitation').properties?.status;
    expect([...InvitationStatusSchema.options].sort()).toEqual([...(status?.enum ?? [])].sort());
  });
});

describe('ProjectInputSchema (FR-005)', () => {
  it('acepta nombre y descripción, y recorta el nombre', () => {
    expect(ProjectInputSchema.parse({ name: '  Tienda  ', description: 'Una tienda' })).toEqual({
      name: 'Tienda',
      description: 'Una tienda',
    });
  });

  it('la descripción es opcional', () => {
    expect(ProjectInputSchema.parse({ name: 'Tienda' })).toEqual({ name: 'Tienda' });
  });

  it.each([
    ['sin nombre', { name: '  ' }],
    ['nombre de 101 caracteres', { name: 'a'.repeat(101) }],
    ['descripción de 2 001 caracteres', { name: 'Tienda', description: 'a'.repeat(2001) }],
  ])('rechaza %s', (_caso, input) => {
    expect(ProjectInputSchema.safeParse(input).success).toBe(false);
  });

  it('coincide con los límites del contrato', () => {
    const { properties } = contractSchema('ProjectInput');
    expect(properties?.name).toMatchObject({ minLength: 1, maxLength: 100 });
    expect(properties?.description).toMatchObject({ maxLength: 2000 });
  });
});

describe('ciclo de estados (FR-006, data-model.md)', () => {
  it.each([
    ['draft', 'open', 'open'],
    ['open', 'close', 'closed'],
    ['closed', 'reopen', 'open'],
  ] as const)('%s + %s → %s', (from, action, to) => {
    expect(nextStatus(from, action)).toBe(to);
  });

  it.each([
    ['draft', 'close'],
    ['draft', 'reopen'],
    ['open', 'open'],
    ['open', 'reopen'],
    ['closed', 'close'],
    ['closed', 'open'],
  ] as const)('%s + %s no es válida', (from, action) => {
    expect(nextStatus(from, action)).toBeNull();
  });

  it('las acciones coinciden con las del contrato', () => {
    expect([...StatusActionSchema.options].sort()).toEqual(['close', 'open', 'reopen']);
  });
});

describe('respuestas', () => {
  const summary = {
    id: 'p1',
    name: 'Tienda',
    status: 'open',
    myRole: 'admin',
    lastActivityAt: '2026-09-30T10:00:00.000Z',
  };

  it('ProjectSummary y Project aceptan respuestas válidas', () => {
    expect(ProjectSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      ProjectSchema.safeParse({
        ...summary,
        description: '',
        memberCount: 1,
        createdAt: '2026-09-30T09:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('una invitación nunca incluye el token', () => {
    const invitation = InvitationSchema.parse({
      id: 'i1',
      status: 'active',
      expiresAt: '2026-10-07T10:00:00.000Z',
      uses: 0,
      token: 'no-debe-salir',
    });
    expect(invitation).not.toHaveProperty('token');
  });
});

describe('invitaciones y miembros', () => {
  it('al crear una invitación, la respuesta añade la URL con el token', () => {
    const created = InvitationCreatedSchema.parse({
      id: 'i1',
      status: 'active',
      expiresAt: '2026-10-07T10:00:00.000Z',
      uses: 0,
      url: 'https://web.example.com/invitacion/abc',
    });
    expect(created.url).toContain('/invitacion/');
  });

  it('la vista previa pública solo expone el nombre del proyecto', () => {
    expect(InvitationPreviewSchema.parse({ projectName: 'Tienda', members: [] })).toEqual({
      projectName: 'Tienda',
    });
  });

  it('un cambio de rol solo admite admin o participant', () => {
    expect(RoleChangeSchema.safeParse({ role: 'participant' }).success).toBe(true);
    expect(RoleChangeSchema.safeParse({ role: 'owner' }).success).toBe(false);
  });
});
