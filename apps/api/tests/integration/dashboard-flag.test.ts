import { FLAGS } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { GATED_PREFIXES } from '../../src/plugins/flags';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { authHeaders, registerTestUser } from '../helpers/users';

// Constitución IV y plan de la 007, ajuste 5: el dashboard se integra detrás de `dashboard`;
// `insights` controla los resúmenes con Claude (coste).

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await closeTestApp(app);
  app = undefined;
});

const ID = '66f3a1b2c3d4e5f601234567';
const ROUTES: Array<['GET' | 'POST' | 'PUT', string]> = [
  ['GET', `/projects/${ID}/dashboard/descriptive`],
  ['GET', `/projects/${ID}/analysis-runs`],
  ['POST', `/projects/${ID}/analysis-runs`],
  ['GET', `/projects/${ID}/analysis-runs/latest`],
  ['GET', `/analysis-runs/${ID}`],
  ['POST', `/analysis-runs/${ID}/insights/i1/feedback`],
  ['POST', `/analysis-runs/${ID}/insights/regenerate`],
  ['POST', `/projects/${ID}/duplicate-decisions`],
  ['GET', `/projects/${ID}/analysis-settings`],
  ['PUT', `/projects/${ID}/analysis-settings`],
];

describe('registro', () => {
  it('dashboard e insights están desactivados por defecto y son de la 007', () => {
    for (const name of ['dashboard', 'insights'] as const) {
      expect(FLAGS[name]).toMatchObject({ default: false, owner: '007-dashboard-analitico' });
    }
  });
});

describe('dashboard desactivado (valor por defecto)', () => {
  it('las rutas del dashboard responden 404 como si no existieran', async () => {
    ({ app } = await buildTestApp('dashboardoff', { withAuth: true }));
    const user = await registerTestUser(app, 'Ana');
    for (const [method, url] of ROUTES) {
      const response = await app.inject({ method, url, headers: authHeaders(user), payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.json()).toEqual({ code: 'NOT_FOUND', message: 'Recurso no encontrado' });
    }
  });

  it('GET /config lo informa al frontend', async () => {
    ({ app } = await buildTestApp('dashboardconfig'));
    expect((await app.inject({ url: '/config' })).json().flags).toMatchObject({
      dashboard: false,
      insights: false,
    });
  });
});

describe('patrón de rutas', () => {
  it('cubre las de la 007 y no las parecidas de la 002–004', () => {
    const gate = GATED_PREFIXES.dashboard!;
    for (const [, url] of ROUTES) expect(gate.test(url), url).toBe(true);
    for (const url of [
      `/projects/${ID}`,
      `/projects/${ID}/members`,
      `/projects/${ID}/invitations`,
      `/projects/${ID}/diagrams`,
      `/details/${ID}`,
      '/projectsx',
      '/analysis-runsx',
    ]) {
      expect(gate.test(url), url).toBe(false);
    }
  });
});

describe('dashboard activado', () => {
  it('GET /config lo informa', async () => {
    ({ app } = await buildTestApp('dashboardon', { featureFlags: 'dashboard=true' }));
    expect((await app.inject({ url: '/config' })).json().flags).toMatchObject({ dashboard: true });
  });
});
