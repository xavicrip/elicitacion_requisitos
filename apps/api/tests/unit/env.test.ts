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
