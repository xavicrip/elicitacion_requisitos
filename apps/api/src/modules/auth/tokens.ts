import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** SHA-256 en hexadecimal: lo único que se guarda de un refresh token o de una invitación. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Refresh token opaco de 32 bytes (research R1). El token solo viaja en la cookie `rt`. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** Familia de sesión: agrupa los refresh tokens rotados desde un mismo login. */
export function newSessionId(): string {
  return randomUUID();
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function refreshExpiry(days: number, now = new Date()): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

/** `15m` → 900. Mismo formato que valida `JWT_ACCESS_TTL` (config/env.ts). */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) throw new Error(`Duración inválida: ${ttl}`);
  return Number(match[1]) * UNIT_SECONDS[match[2] as keyof typeof UNIT_SECONDS];
}
