import { FLAGS } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { GATED_PREFIXES } from '../../src/plugins/flags';
import { buildTestApp, closeTestApp } from '../helpers/app';

// Feature 008: el flag `exports` se retiró tras recorrerla en staging (constitución IV).

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await closeTestApp(app);
  app = undefined;
});

const ID = '66f3a1b2c3d4e5f601234567';

describe('flag de la exportación', () => {
  it('exports ya no existe', () => {
    expect(FLAGS).not.toHaveProperty('exports');
    expect(GATED_PREFIXES).not.toHaveProperty('exports');
  });

  it('las rutas existen sin FEATURE_FLAGS (piden sesión, no responden 404)', async () => {
    ({ app } = await buildTestApp('exportsalways', { withAuth: true }));
    for (const url of [`/projects/${ID}/exports`, `/exports/${ID}`, `/exports/${ID}/download`]) {
      expect((await app.inject({ url })).statusCode, url).toBe(401);
    }
    expect(app.hasDecorator('exportFiles')).toBe(true);
    expect(app.hasDecorator('exportPdf')).toBe(true);
  });

  it('GET /config ya no informa exports', async () => {
    ({ app } = await buildTestApp('exportsconfig'));
    expect((await app.inject({ url: '/config' })).json().flags).not.toHaveProperty('exports');
  });
});
