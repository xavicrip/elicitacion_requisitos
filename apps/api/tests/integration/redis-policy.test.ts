import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkEvictionPolicy } from '../../src/plugins/redis';
import { buildTestApp, closeTestApp } from '../helpers/app';

/** Cliente mínimo que responde a `CONFIG GET maxmemory-policy`. */
const fakeRedis = (reply: () => Promise<unknown>) => ({
  config: (..._args: unknown[]) => reply(),
});

describe('política de memoria de Redis para BullMQ (plan, ajuste 7)', () => {
  it('noeviction es correcta', async () => {
    const redis = fakeRedis(async () => ['maxmemory-policy', 'noeviction']);
    expect(await checkEvictionPolicy(redis)).toEqual({ ok: true, policy: 'noeviction' });
  });

  it('cualquier otra política genera un aviso que la nombra', async () => {
    const redis = fakeRedis(async () => ['maxmemory-policy', 'allkeys-lru']);
    expect(await checkEvictionPolicy(redis)).toEqual({
      ok: false,
      policy: 'allkeys-lru',
      warning: 'maxmemory-policy es allkeys-lru; BullMQ requiere noeviction',
    });
  });

  it('si CONFIG está bloqueado (Redis gestionado), no se puede comprobar pero no es un fallo', async () => {
    const redis = fakeRedis(async () => {
      throw new Error("ERR unknown command 'CONFIG'");
    });
    expect(await checkEvictionPolicy(redis)).toEqual({ ok: true, policy: 'desconocida' });
  });
});

describe('/health/deep con el Redis de pruebas', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildTestApp('redispolicy'));
    await app.ready();
  });

  afterAll(() => closeTestApp(app));

  it('el Redis de pruebas usa noeviction y el check no lleva aviso', async () => {
    expect(await app.redis.config('GET', 'maxmemory-policy')).toEqual([
      'maxmemory-policy',
      'noeviction',
    ]);
    // Espera a que termine la comprobación que se lanza al conectar.
    await app.redisPolicyCheck;
    const response = await app.inject({ url: '/health/deep' });
    expect(response.json().checks.redis).not.toHaveProperty('warning');
  });

  it('con una política incorrecta, /health/deep incluye el aviso en checks.redis', async () => {
    app.redisPolicyWarning = 'maxmemory-policy es allkeys-lru; BullMQ requiere noeviction';
    try {
      const response = await app.inject({ url: '/health/deep' });
      expect(response.json().checks.redis).toMatchObject({
        status: 'up',
        warning: 'maxmemory-policy es allkeys-lru; BullMQ requiere noeviction',
      });
    } finally {
      app.redisPolicyWarning = undefined;
    }
  });
});
