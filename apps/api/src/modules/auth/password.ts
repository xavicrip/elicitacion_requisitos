import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, verify } from '@node-rs/argon2';
import { PASSWORD_MIN_LENGTH } from '@reqcanvas/shared';

/**
 * argon2id con los parámetros mínimos de OWASP (research R3). `algorithm: 2` es
 * `Algorithm.Argon2id`: es un `const enum` y no se puede importar con `isolatedModules`.
 */
export const ARGON2_OPTIONS = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** `false` también si el hash está corrupto: nunca lanza por datos de la base. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * `data/common-passwords.txt` está fuera de `src/` (el Dockerfile elimina `src/`): se busca
 * hacia arriba, como `migrations/`, porque la profundidad cambia entre el código y el bundle.
 */
function findCommonPasswordsFile(start: string): string {
  for (let dir = start; dir !== dirname(dir); dir = dirname(dir)) {
    const candidate = join(dir, 'data', 'common-passwords.txt');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('No se encontró data/common-passwords.txt');
}

let commonPasswords: Set<string> | undefined;

function isCommon(password: string): boolean {
  commonPasswords ??= new Set(
    readFileSync(findCommonPasswordsFile(dirname(fileURLToPath(import.meta.url))), 'utf8')
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith('#')),
  );
  return commonPasswords.has(password.toLowerCase());
}

export type PolicyResult = { ok: true } | { ok: false; message: string };

/** Política de contraseña (FR-002): longitud mínima y fuera de la lista de comunes. */
export function checkPasswordPolicy(password: string): PolicyResult {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    };
  }
  if (isCommon(password)) {
    return { ok: false, message: 'Esa contraseña es demasiado común. Elige otra.' };
  }
  return { ok: true };
}
