import { describe, expect, it } from 'vitest';
import { ConfigError, loadEnv } from '../../src/config/env';

const valid = {
  NODE_ENV: 'production',
  PORT: '3000',
  MONGO_URL: 'mongodb://user:s3cret-mongo@mongo:27017',
  MONGO_DB: 'reqcanvas',
  REDIS_URL: 'redis://default:s3cret-redis@redis:6379',
  ANALYTICS_URL: 'http://analytics.railway.internal:8000',
  CORS_ORIGINS: 'https://web.example.com,https://otro.example.com',
  JWT_SECRET: 's3cret-jwt-0123456789abcdef0123456789',
  APP_BASE_URL: 'https://web.example.com',
  S3_ENDPOINT: 'https://storage.railway.app',
  S3_BUCKET: 'reqcanvas',
  S3_ACCESS_KEY_ID: 's3cret-key-id',
  S3_SECRET_ACCESS_KEY: 's3cret-access-key',
};

describe('loadEnv', () => {
  it('acepta una configuración completa y aplica valores por defecto', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe('::');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.CORS_ORIGINS).toEqual(['https://web.example.com', 'https://otro.example.com']);
    expect(env.APP_VERSION).toBe('dev');
  });

  it('falla nombrando la variable obligatoria que falta', () => {
    const { MONGO_URL: _omit, ...rest } = valid;
    expect(() => loadEnv(rest)).toThrow(ConfigError);
    expect(() => loadEnv(rest)).toThrow(/MONGO_URL/);
  });

  it('trata una variable vacía como ausente', () => {
    expect(() => loadEnv({ ...valid, MONGO_URL: '' })).toThrow(/MONGO_URL/);
  });

  describe('sesión (feature 002)', () => {
    it('aplica los valores por defecto de las duraciones', () => {
      const env = loadEnv(valid);
      expect(env.JWT_ACCESS_TTL).toBe('15m');
      expect(env.REFRESH_TTL_DAYS).toBe(7);
      expect(env.APP_BASE_URL).toBe('https://web.example.com');
    });

    it.each(['JWT_SECRET', 'APP_BASE_URL'] as const)('%s es obligatoria', (name) => {
      const { [name]: _omit, ...rest } = valid;
      expect(() => loadEnv(rest)).toThrow(new RegExp(name));
    });

    it('rechaza un JWT_SECRET de menos de 32 bytes sin mostrarlo', () => {
      try {
        loadEnv({ ...valid, JWT_SECRET: 's3cret-corto' });
        expect.unreachable();
      } catch (error) {
        expect((error as ConfigError).variables).toEqual(['JWT_SECRET']);
        expect((error as Error).message).not.toMatch(/s3cret/);
      }
    });

    it('cuenta los bytes, no los caracteres, del JWT_SECRET', () => {
      // 16 caracteres de 2 bytes en UTF-8 = 32 bytes.
      expect(() => loadEnv({ ...valid, JWT_SECRET: 'ñ'.repeat(16) })).not.toThrow();
      expect(() => loadEnv({ ...valid, JWT_SECRET: 'ñ'.repeat(15) })).toThrow(/JWT_SECRET/);
    });

    it.each([
      ['JWT_ACCESS_TTL', 'quince'],
      ['REFRESH_TTL_DAYS', '0'],
      ['APP_BASE_URL', 'no-es-una-url'],
    ])('rechaza %s=%s', (name, value) => {
      expect(() => loadEnv({ ...valid, [name]: value })).toThrow(new RegExp(name));
    });
  });

  describe('almacenamiento S3 (feature 003)', () => {
    it('aplica los valores por defecto', () => {
      const env = loadEnv(valid);
      expect(env).toMatchObject({
        S3_ENDPOINT: 'https://storage.railway.app',
        S3_BUCKET: 'reqcanvas',
        S3_REGION: 'auto',
        S3_FORCE_PATH_STYLE: false,
        S3_CREATE_BUCKET: false,
      });
    });

    it.each(['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const)(
      '%s es obligatoria y el error no muestra ningún valor',
      (name) => {
        const { [name]: _omit, ...rest } = valid;
        try {
          loadEnv(rest);
          expect.unreachable();
        } catch (error) {
          expect((error as ConfigError).variables).toEqual([name]);
          expect((error as Error).message).not.toMatch(/s3cret/);
        }
      },
    );

    it.each([
      ['true', true],
      ['false', false],
    ])('S3_FORCE_PATH_STYLE y S3_CREATE_BUCKET aceptan "%s"', (value, expected) => {
      const env = loadEnv({ ...valid, S3_FORCE_PATH_STYLE: value, S3_CREATE_BUCKET: value });
      expect(env.S3_FORCE_PATH_STYLE).toBe(expected);
      expect(env.S3_CREATE_BUCKET).toBe(expected);
    });

    it.each([
      ['S3_ENDPOINT', 'no-es-una-url'],
      ['S3_FORCE_PATH_STYLE', 'quizá'],
    ])('rechaza %s=%s', (name, value) => {
      expect(() => loadEnv({ ...valid, [name]: value })).toThrow(new RegExp(name));
    });
  });

  it('lista todas las variables inválidas y nunca incluye valores', () => {
    try {
      loadEnv({
        ...valid,
        REDIS_URL: 'no-es-una-url s3cret-redis',
        PORT: 'abc',
        MONGO_DB: undefined,
      });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/REDIS_URL/);
      expect(message).toMatch(/PORT/);
      expect(message).toMatch(/MONGO_DB/);
      expect(message).not.toMatch(/s3cret/);
      expect((error as ConfigError).variables).toEqual(
        expect.arrayContaining(['REDIS_URL', 'PORT', 'MONGO_DB']),
      );
    }
  });
});
