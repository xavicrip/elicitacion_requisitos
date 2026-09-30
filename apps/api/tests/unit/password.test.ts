import { describe, expect, it } from 'vitest';
import {
  ARGON2_OPTIONS,
  checkPasswordPolicy,
  hashPassword,
  verifyPassword,
} from '../../src/modules/auth/password';

describe('hash de contraseñas (research R3)', () => {
  it('usa argon2id con los parámetros de OWASP (19 MiB, t=2, p=1)', async () => {
    expect(ARGON2_OPTIONS).toMatchObject({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const hash = await hashPassword('una-frase-muy-larga');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('cada hash lleva su propia sal', async () => {
    const [a, b] = await Promise.all([
      hashPassword('misma-clave-1'),
      hashPassword('misma-clave-1'),
    ]);
    expect(a).not.toBe(b);
  });

  it('verifica la contraseña correcta y rechaza las demás', async () => {
    const hash = await hashPassword('una-frase-muy-larga');
    expect(await verifyPassword(hash, 'una-frase-muy-larga')).toBe(true);
    expect(await verifyPassword(hash, 'una-frase-muy-larg')).toBe(false);
  });

  it('un hash corrupto no lanza: simplemente no verifica', async () => {
    expect(await verifyPassword('no-es-un-hash', 'lo-que-sea-largo')).toBe(false);
  });
});

describe('política de contraseña (FR-002)', () => {
  it('acepta una contraseña de 10 caracteres que no es común', () => {
    expect(checkPasswordPolicy('ventana-17')).toEqual({ ok: true });
  });

  it('rechaza menos de 10 caracteres', () => {
    expect(checkPasswordPolicy('corta-123')).toEqual({
      ok: false,
      message: 'La contraseña debe tener al menos 10 caracteres.',
    });
  });

  it.each(['1234567890', 'qwertyuiop', 'basketball'])(
    'rechaza una contraseña de la lista de comunes (%s)',
    (password) => {
      expect(checkPasswordPolicy(password)).toEqual({
        ok: false,
        message: 'Esa contraseña es demasiado común. Elige otra.',
      });
    },
  );

  it('la comparación con la lista no distingue mayúsculas', () => {
    expect(checkPasswordPolicy('QWERTYUIOP').ok).toBe(false);
  });
});
