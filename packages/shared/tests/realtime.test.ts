import { describe, expect, it } from 'vitest';
import {
  AccessRevokedSchema,
  AuthRefreshSchema,
  CLIENT_EVENTS,
  CursorMoveSchema,
  CursorMovedSchema,
  PRESENCE_COLORS,
  PresenceEntrySchema,
  PresenceSelectSchema,
  PresenceUpdateSchema,
  ProjectRoomSchema,
  SOCKET_SERVER_EVENTS,
  VersionRoomSchema,
  presenceColor,
} from '../src/realtime';

// Contrato de specs/005-colaboracion-tiempo-real/contracts/socket-events.md.

const versionId = '6abeda22094f145792df717a';

describe('eventos del cliente al servidor', () => {
  it('los nombres coinciden con el contrato', () => {
    expect([...CLIENT_EVENTS].sort()).toEqual(
      [
        'auth:refresh',
        'cursor:move',
        'presence:heartbeat',
        'presence:select',
        'room:join',
        'room:leave',
      ].sort(),
    );
  });

  it('room:join, room:leave y presence:heartbeat llevan la versión', () => {
    expect(VersionRoomSchema.parse({ versionId })).toEqual({ versionId });
    expect(VersionRoomSchema.safeParse({}).success).toBe(false);
    expect(VersionRoomSchema.safeParse({ versionId: '' }).success).toBe(false);
    expect(VersionRoomSchema.safeParse({ versionId: 42 }).success).toBe(false);
  });

  it('presence:select admite una actividad o null', () => {
    expect(PresenceSelectSchema.parse({ versionId, activityKey: 'k1' }).activityKey).toBe('k1');
    expect(PresenceSelectSchema.parse({ versionId, activityKey: null }).activityKey).toBeNull();
    expect(PresenceSelectSchema.safeParse({ versionId }).success).toBe(false);
    expect(PresenceSelectSchema.safeParse({ versionId, activityKey: '' }).success).toBe(false);
  });

  it('cursor:move exige coordenadas de imagen finitas y no negativas', () => {
    expect(CursorMoveSchema.parse({ versionId, x: 10.5, y: 0 })).toEqual({
      versionId,
      x: 10.5,
      y: 0,
    });
    for (const bad of [
      { x: -1, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: '1', y: 0 },
      { x: 1 },
    ]) {
      expect(CursorMoveSchema.safeParse({ versionId, ...bad }).success).toBe(false);
    }
  });

  it('auth:refresh exige un token', () => {
    expect(AuthRefreshSchema.parse({ token: 'abc' })).toEqual({ token: 'abc' });
    expect(AuthRefreshSchema.safeParse({ token: '' }).success).toBe(false);
  });
});

describe('eventos propios del socket, del servidor al cliente', () => {
  const entry = { userId: 'u1', name: 'Ana', color: '#1D4ED8', selectedActivityKey: null };

  it('los nombres coinciden con el contrato', () => {
    expect([...SOCKET_SERVER_EVENTS].sort()).toEqual(
      [
        'access:revoked',
        'cursor:moved',
        'presence:update',
        'project:closed',
        'project:reopened',
      ].sort(),
    );
  });

  it('PresenceEntry y presence:update (como mucho 50 entradas)', () => {
    expect(PresenceEntrySchema.parse(entry)).toEqual(entry);
    expect(PresenceEntrySchema.safeParse({ ...entry, color: 'azul' }).success).toBe(false);
    expect(PresenceUpdateSchema.parse({ entries: [entry] }).entries).toHaveLength(1);
    const many = Array.from({ length: 51 }, (_, i) => ({ ...entry, userId: `u${i}` }));
    expect(PresenceUpdateSchema.safeParse({ entries: many }).success).toBe(false);
  });

  it('cursor:moved, access:revoked y los cambios de estado del proyecto', () => {
    expect(CursorMovedSchema.parse({ userId: 'u1', x: 1, y: 2 })).toEqual({
      userId: 'u1',
      x: 1,
      y: 2,
    });
    expect(AccessRevokedSchema.parse({ projectId: 'p1', reason: 'removed' }).reason).toBe(
      'removed',
    );
    expect(AccessRevokedSchema.safeParse({ projectId: 'p1', reason: 'logout' }).success).toBe(
      false,
    );
    expect(ProjectRoomSchema.parse({ projectId: 'p1' })).toEqual({ projectId: 'p1' });
  });
});

/** Contraste WCAG de un color `#RRGGBB` sobre blanco. */
function contrastOnWhite(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05);
}

describe('color de presencia (research R5)', () => {
  it('la paleta tiene 12 colores distintos con contraste AA sobre blanco', () => {
    expect(new Set(PRESENCE_COLORS).size).toBe(12);
    for (const color of PRESENCE_COLORS) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/);
      expect(contrastOnWhite(color)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('es estable por usuario y usa toda la paleta', () => {
    expect(presenceColor('6abeda20094f145792df7171')).toBe(
      presenceColor('6abeda20094f145792df7171'),
    );
    const used = new Set(
      Array.from({ length: 500 }, (_, i) => presenceColor(i.toString(16).padStart(24, '0'))),
    );
    expect(used.size).toBe(12);
  });
});
