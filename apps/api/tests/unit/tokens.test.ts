import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hashToken,
  newRefreshToken,
  newSessionId,
  refreshExpiry,
  ttlToSeconds,
} from '../../src/modules/auth/tokens';

describe('refresh token opaco (research R1)', () => {
  it('son 32 bytes aleatorios en base64url', () => {
    const { token } = newRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('cada token es distinto', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => newRefreshToken().token));
    expect(tokens.size).toBe(100);
  });

  it('en la base de datos solo se guarda su hash SHA-256', () => {
    const { token, hash } = newRefreshToken();
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
  });
});

describe('sesiones', () => {
  it('el identificador de sesión (familia) es un UUID', () => {
    expect(newSessionId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(newSessionId()).not.toBe(newSessionId());
  });

  it('el refresh caduca REFRESH_TTL_DAYS días después', () => {
    const now = new Date('2026-09-30T10:00:00.000Z');
    expect(refreshExpiry(7, now).toISOString()).toBe('2026-10-07T10:00:00.000Z');
  });
});

describe('ttlToSeconds (JWT_ACCESS_TTL)', () => {
  it.each([
    ['45s', 45],
    ['15m', 900],
    ['2h', 7200],
    ['1d', 86400],
  ])('%s → %i segundos', (ttl, seconds) => {
    expect(ttlToSeconds(ttl)).toBe(seconds);
  });

  it('rechaza un formato inválido', () => {
    expect(() => ttlToSeconds('quince')).toThrow();
  });
});
