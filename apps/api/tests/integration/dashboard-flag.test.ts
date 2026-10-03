import { FLAGS } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { GATED_PREFIXES } from '../../src/plugins/flags';
import { buildTestApp, closeTestApp } from '../helpers/app';

// Feature 007: el flag `dashboard` se retiró tras recorrerla en staging (constitución IV); queda
// `insights`, un flag operativo para los resúmenes con Claude (coste).

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await closeTestApp(app);
  app = undefined;
});

const ID = '66f3a1b2c3d4e5f601234567';

describe('flags del dashboard', () => {
  it('dashboard ya no existe; insights sigue desactivado por defecto', () => {
    expect(FLAGS).not.toHaveProperty('dashboard');
    expect(GATED_PREFIXES).not.toHaveProperty('dashboard');
    expect(FLAGS.insights).toMatchObject({ default: false, owner: '007-dashboard-analitico' });
  });

  it('las rutas del dashboard existen sin FEATURE_FLAGS (piden sesión, no responden 404)', async () => {
    ({ app } = await buildTestApp('dashboardalways', { withAuth: true }));
    for (const url of [
      `/projects/${ID}/dashboard/descriptive`,
      `/projects/${ID}/analysis-runs/latest`,
      `/analysis-runs/${ID}`,
      `/projects/${ID}/analysis-settings`,
    ]) {
      expect((await app.inject({ url })).statusCode, url).toBe(401);
    }
    expect(app.hasDecorator('analysis')).toBe(true);
    expect(app.hasDecorator('analysisSchedule')).toBe(true);
  });

  it('GET /config ya no informa dashboard', async () => {
    ({ app } = await buildTestApp('dashboardconfig'));
    const flags = (await app.inject({ url: '/config' })).json().flags;
    expect(flags).not.toHaveProperty('dashboard');
    expect(flags).toMatchObject({ insights: false });
  });
});
