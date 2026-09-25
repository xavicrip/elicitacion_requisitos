import { HealthSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../../src/app';
import { startFakeAnalytics } from '../helpers/fake-analytics';
import { MONGO_TEST_URL, REDIS_TEST_URL, uniqueDbName } from '../helpers/services';

// Contrato: specs/001-plataforma-base/contracts/health.openapi.yaml
const VersionSchema = z.object({ service: z.string(), version: z.string(), commit: z.string() });
const ConfigSchema = z.object({ flags: z.record(z.string(), z.boolean()) });

let app: FastifyInstance;
let analytics: Awaited<ReturnType<typeof startFakeAnalytics>>;

beforeAll(async () => {
  analytics = await startFakeAnalytics();
  app = await buildApp({
    logLevel: 'silent',
    services: {
      mongoUrl: MONGO_TEST_URL,
      mongoDb: uniqueDbName('contract'),
      redisUrl: REDIS_TEST_URL,
      analyticsUrl: analytics.url,
      version: '0.1.0',
      commit: 'abc1234',
      featureFlags: undefined,
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await analytics.close();
});

describe('contrato de salud de la API', () => {
  it.each(['/health', '/health/deep'])('GET %s cumple el esquema Health', async (url) => {
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['x-request-id']).toBeDefined();
    const body = HealthSchema.parse(response.json());
    expect(body.service).toBe('api');
    expect(body.version).toBe('0.1.0');
    expect(body.commit).toBe('abc1234');
  });

  it('GET /health solo incluye las dependencias directas (mongo, redis)', async () => {
    const body = HealthSchema.parse((await app.inject({ url: '/health' })).json());
    expect(Object.keys(body.checks).sort()).toEqual(['mongo', 'redis']);
  });

  it('GET /health/deep incluye además analytics', async () => {
    const body = HealthSchema.parse((await app.inject({ url: '/health/deep' })).json());
    expect(Object.keys(body.checks).sort()).toEqual(['analytics', 'mongo', 'redis']);
  });

  it('GET /version cumple el contrato', async () => {
    const body = VersionSchema.parse((await app.inject({ url: '/version' })).json());
    expect(body).toEqual({ service: 'api', version: '0.1.0', commit: 'abc1234' });
  });

  it('GET /config expone los flags activos', async () => {
    const response = await app.inject({ url: '/config' });
    expect(response.statusCode).toBe(200);
    ConfigSchema.parse(response.json());
  });
});
