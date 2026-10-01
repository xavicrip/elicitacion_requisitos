import { describe, expect, it } from 'vitest';
import { detailPermissions, type DetailStatus } from '../src/details';

// Regla de permisos de la 004 (research R5), compartida con web para los detalles que llegan
// por el socket sin `permissions` (plan de la 005, ajuste 7).

const author = { userId: 'u1', role: 'participant' as const };
const other = { userId: 'u2', role: 'participant' as const };
const admin = { userId: 'u3', role: 'admin' as const };
const detail = (status: DetailStatus = 'pending') => ({ status, authorId: 'u1' });

describe('detailPermissions', () => {
  it('el autor edita y borra su detalle pendiente, pero no lo vota ni lo modera', () => {
    expect(detailPermissions(detail(), author, 'open')).toEqual({
      canEdit: true,
      canDelete: true,
      canVote: false,
      canModerate: false,
    });
  });

  it('el autor ya no edita un detalle moderado', () => {
    for (const status of ['validated', 'duplicate', 'discarded'] as const) {
      expect(detailPermissions(detail(status), author, 'open').canEdit).toBe(false);
    }
  });

  it('otro participante solo vota los pendientes o validados', () => {
    expect(detailPermissions(detail(), other, 'open')).toEqual({
      canEdit: false,
      canDelete: false,
      canVote: true,
      canModerate: false,
    });
    expect(detailPermissions(detail('validated'), other, 'open').canVote).toBe(true);
    expect(detailPermissions(detail('duplicate'), other, 'open').canVote).toBe(false);
    expect(detailPermissions(detail('discarded'), other, 'open').canVote).toBe(false);
  });

  it('el Administrador edita los pendientes y validados, y modera', () => {
    expect(detailPermissions(detail('validated'), admin, 'open')).toEqual({
      canEdit: true,
      canDelete: true,
      canVote: true,
      canModerate: true,
    });
    expect(detailPermissions(detail('duplicate'), admin, 'open').canEdit).toBe(false);
  });

  it('con el proyecto no abierto, todo es de solo lectura (FR-013)', () => {
    for (const status of ['draft', 'closed'] as const) {
      for (const viewer of [author, other, admin]) {
        expect(detailPermissions(detail(), viewer, status)).toEqual({
          canEdit: false,
          canDelete: false,
          canVote: false,
          canModerate: false,
        });
      }
    }
  });
});
