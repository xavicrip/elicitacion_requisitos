import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH_RATE_LIMIT, rateLimitPlugin } from '../../src/plugins/rate-limit';
import { buildTestApp, closeTestApp } from '../helpers/app';

let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await buildTestApp('ratelimit'));
  // Espacio de nombres único: las claves de Redis no chocan entre ejecuciones.
  await app.register(rateLimitPlugin, { nameSpace: `rl-test-${Date.now()}:` });
  app.post('/auth/prueba', { config: { rateLimit: AUTH_RATE_LIMIT } }, async () => ({ ok: true }));
  app.get('/libre', async () => ({ ok: true }));
  await app.ready();
});

afterAll(() => closeTestApp(app));

const hit = (ip: string, url = '/auth/prueba') =>
  app.inject({ method: url === '/libre' ? 'GET' : 'POST', url, remoteAddress: ip });

describe('rate limit de /auth/* (research R4)', () => {
  it('permite 20 peticiones por minuto e IP y responde 429 a la 21.ª', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await hit('10.0.0.1')).statusCode).toBe(200);
    }
    const blocked = await hit('10.0.0.1');
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.json()).toEqual({
      code: 'TOO_MANY_REQUESTS',
      message: 'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.',
    });
  });

  it('cuenta cada IP por separado', async () => {
    expect((await hit('10.0.0.2')).statusCode).toBe(200);
  });

  it('no limita las rutas que no lo configuran', async () => {
    for (let i = 0; i < 25; i++) await hit('10.0.0.3', '/libre');
    expect((await hit('10.0.0.3', '/libre')).statusCode).toBe(200);
  });

  it('guarda los contadores en Redis (compartidos entre réplicas de api)', async () => {
    const keys = await app.redis.keys('rl-test-*');
    expect(keys.length).toBeGreaterThan(0);
  });
});
