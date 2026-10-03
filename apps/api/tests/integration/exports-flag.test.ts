import { FLAGS } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { GATED_PREFIXES } from '../../src/plugins/flags';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { authHeaders, registerTestUser } from '../helpers/users';

// Constitución IV y plan de la 008, ajuste 10: la exportación se integra detrás de `exports`.

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await closeTestApp(app);
  app = undefined;
});

const ID = '66f3a1b2c3d4e5f601234567';
const ROUTES: Array<['GET' | 'POST', string]> = [
  ['GET', `/projects/${ID}/exports`],
  ['POST', `/projects/${ID}/exports`],
  ['GET', `/exports/${ID}`],
  ['GET', `/exports/${ID}/download`],
];

describe('registro', () => {
  it('exports está activado por defecto y es de la 008', () => {
    expect(FLAGS.exports).toMatchObject({ default: true, owner: '008-exportacion-resultados' });
  });
});

describe('exports desactivado', () => {
  it('las rutas de exportación responden 404 como si no existieran', async () => {
    ({ app } = await buildTestApp('exportsoff', { withAuth: true, featureFlags: 'exports=false' }));
    const user = await registerTestUser(app, 'Ana');
    for (const [method, url] of ROUTES) {
      const response = await app.inject({
        method,
        url,
        headers: authHeaders(user),
        ...(method === 'POST' ? { payload: { format: 'csv' } } : {}),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.json()).toEqual({ code: 'NOT_FOUND', message: 'Recurso no encontrado' });
    }
  });

  it('GET /config lo informa al frontend', async () => {
    ({ app } = await buildTestApp('exportsconfig', { featureFlags: 'exports=false' }));
    expect((await app.inject({ url: '/config' })).json().flags).toMatchObject({ exports: false });
  });
});

describe('patrón de rutas', () => {
  it('cubre las de la 008 y no las parecidas', () => {
    const gate = GATED_PREFIXES.exports!;
    for (const [, url] of ROUTES) expect(gate.test(url), url).toBe(true);
    expect(gate.test(`/projects/${ID}/exports?limit=5`)).toBe(true);
    for (const url of [
      `/projects/${ID}`,
      `/projects/${ID}/dashboard/descriptive`,
      `/projects/${ID}/exportsx`,
      '/exportsx',
      `/details/${ID}`,
    ]) {
      expect(gate.test(url), url).toBe(false);
    }
  });
});

describe('exports activado (valor por defecto)', () => {
  it('GET /config lo informa', async () => {
    ({ app } = await buildTestApp('exportson'));
    expect((await app.inject({ url: '/config' })).json().flags).toMatchObject({ exports: true });
  });
});
