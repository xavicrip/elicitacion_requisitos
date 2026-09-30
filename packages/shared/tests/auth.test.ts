import { describe, expect, it } from 'vitest';
import {
  LoginInputSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RegisterInputSchema,
  SessionUserSchema,
} from '../src/auth';
import { contractSchema } from './contract';

const valid = { name: 'Ana Pérez', email: 'Ana@Example.com', password: 'una-frase-larga' };

describe('RegisterInputSchema', () => {
  it('acepta un registro válido y normaliza el email a minúsculas', () => {
    const result = RegisterInputSchema.parse(valid);
    expect(result.email).toBe('ana@example.com');
  });

  it('recorta los espacios del nombre y del email', () => {
    const result = RegisterInputSchema.parse({
      ...valid,
      name: '  Ana  ',
      email: ' ana@example.com ',
    });
    expect(result).toMatchObject({ name: 'Ana', email: 'ana@example.com' });
  });

  it.each([
    ['nombre vacío', { name: '   ' }],
    ['nombre de más de 80 caracteres', { name: 'a'.repeat(81) }],
    ['email inválido', { email: 'no-es-un-email' }],
    ['contraseña de 9 caracteres', { password: '123456789' }],
    ['contraseña de más de 128 caracteres', { password: 'a'.repeat(129) }],
  ])('rechaza %s', (_caso, override) => {
    const result = RegisterInputSchema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
  });

  it('no recorta la contraseña (los espacios cuentan)', () => {
    expect(RegisterInputSchema.parse({ ...valid, password: ' diez-chars' }).password).toBe(
      ' diez-chars',
    );
  });

  it('coincide con los límites del contrato (FR-002)', () => {
    const { properties } = contractSchema('RegisterInput');
    expect(properties?.password).toMatchObject({
      minLength: PASSWORD_MIN_LENGTH,
      maxLength: PASSWORD_MAX_LENGTH,
    });
    expect(properties?.name).toMatchObject({ minLength: 1, maxLength: 80 });
  });
});

describe('LoginInputSchema', () => {
  it('normaliza el email y no aplica la política de contraseña', () => {
    expect(LoginInputSchema.parse({ email: 'ANA@example.com', password: 'corta' })).toEqual({
      email: 'ana@example.com',
      password: 'corta',
    });
  });

  it('exige una contraseña no vacía', () => {
    expect(LoginInputSchema.safeParse({ email: 'ana@example.com', password: '' }).success).toBe(
      false,
    );
  });
});

describe('SessionUserSchema', () => {
  it('solo expone id, nombre y email', () => {
    const user = SessionUserSchema.parse({
      id: 'u1',
      name: 'Ana',
      email: 'ana@example.com',
      passwordHash: 'no-debe-salir',
    });
    expect(user).toEqual({ id: 'u1', name: 'Ana', email: 'ana@example.com' });
  });
});
