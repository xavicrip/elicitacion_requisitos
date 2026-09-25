import { HealthSchema } from '@reqcanvas/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type ServicesConfig } from '../../src/app';
import { startFakeAnalytics } from '../helpers/fake-analytics';
import { MONGO_TEST_URL, REDIS_TEST_URL, uniqueDbName } from '../helpers/services';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function appWith(overrides: Partial<ServicesConfig>) {
  const analytics = await startFakeAnalytics(overrides.analyticsUrl === 'fail' ? 503 : 200);
  const app = await buildApp({
    logLevel: 'silent',
    services: {
      mongoUrl: MONGO_TEST_URL,
      mongoDb: uniqueDbName('health'),
      redisUrl: REDIS_TEST_URL,
      version: 'test',
      commit: 'test',
      featureFlags: undefined,
      checkTimeoutMs: 500,
      ...overrides,
      analyticsUrl:
        overrides.analyticsUrl === 'fail'
          ? analytics.url
          : (overrides.analyticsUrl ?? analytics.url),
    },
  });
  await app.ready();
  cleanups.push(() => app.close(), analytics.close);
  return { app, analytics };
}

describe('GET /health', () => {
  it('200 ok con Mongo y Redis disponibles', async () => {
    const { app } = await appWith({});
    const response = await app.inject({ url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = HealthSchema.parse(response.json());
    expect(body.status).toBe('ok');
    expect(body.checks.mongo?.status).toBe('up');
    expect(body.checks.redis?.status).toBe('up');
  });

  it('503 degraded e indica la dependencia con Mongo caído', async () => {
    const { app } = await appWith({ mongoUrl: 'mongodb://127.0.0.1:1' });
    const response = await app.inject({ url: '/health' });
    expect(response.statusCode).toBe(503);
    const body = HealthSchema.parse(response.json());
    expect(body.status).toBe('degraded');
    expect(body.checks.mongo?.status).toBe('down');
    expect(body.checks.mongo?.error).toBeTruthy();
    expect(body.checks.redis?.status).toBe('up');
  });

  it('503 degraded con Redis caído', async () => {
    const { app } = await appWith({ redisUrl: 'redis://127.0.0.1:1' });
    const response = await app.inject({ url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(HealthSchema.parse(response.json()).checks.redis?.status).toBe('down');
  });

  it('no depende de analytics (una caída de analytics no bloquea los despliegues de api)', async () => {
    const { app } = await appWith({ analyticsUrl: 'http://127.0.0.1:1' });
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
  });
});

describe('GET /health/deep', () => {
  it('503 si analytics no responde', async () => {
    const { app } = await appWith({ analyticsUrl: 'http://127.0.0.1:1' });
    const response = await app.inject({ url: '/health/deep' });
    expect(response.statusCode).toBe(503);
    expect(HealthSchema.parse(response.json()).checks.analytics?.status).toBe('down');
  });

  it('503 si analytics responde con error', async () => {
    const { app } = await appWith({ analyticsUrl: 'fail' });
    const response = await app.inject({ url: '/health/deep' });
    expect(response.statusCode).toBe(503);
  });

  it('reenvía x-request-id a analytics', async () => {
    const { app, analytics } = await appWith({});
    await app.inject({ url: '/health/deep', headers: { 'x-request-id': 'prueba-deep-1' } });
    expect(analytics.received.at(-1)?.['x-request-id']).toBe('prueba-deep-1');
  });
});
