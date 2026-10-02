import { FLAGS } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { GATED_PREFIXES } from '../../src/plugins/flags';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { authHeaders, registerTestUser } from '../helpers/users';

// Constitución IV y plan de la 006, ajuste 3: la detección se integra detrás de `detection`;
// `detection-llm` controla el refinamiento opcional con Claude (coste).

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await closeTestApp(app);
  app = undefined;
});

const ROUTES: Array<['GET' | 'POST', string]> = [
  ['POST', '/diagram-versions/66f3a1b2c3d4e5f601234567/detections'],
  ['GET', '/diagram-versions/66f3a1b2c3d4e5f601234567/detections'],
  ['GET', '/diagram-versions/66f3a1b2c3d4e5f601234567/proposals'],
  ['POST', '/diagram-versions/66f3a1b2c3d4e5f601234567/proposals/accept-high'],
  ['POST', '/proposals/66f3a1b2c3d4e5f601234567/accept'],
  ['POST', '/proposals/66f3a1b2c3d4e5f601234567/discard'],
  ['POST', '/transition-proposals/66f3a1b2c3d4e5f601234567/accept'],
];

describe('registro', () => {
  it('detection está activado por defecto (T052); detection-llm sigue desactivado (coste)', () => {
    expect(FLAGS.detection).toMatchObject({ default: true, owner: '006-deteccion-asistida' });
    expect(FLAGS['detection-llm']).toMatchObject({
      default: false,
      owner: '006-deteccion-asistida',
    });
  });
});

describe('detection desactivado (FEATURE_FLAGS=detection=false)', () => {
  it('las rutas de la detección responden 404 como si no existieran', async () => {
    ({ app } = await buildTestApp('detectionoff', {
      withAuth: true,
      featureFlags: 'detection=false',
    }));
    const user = await registerTestUser(app, 'Ana');
    for (const [method, url] of ROUTES) {
      const response = await app.inject({ method, url, headers: authHeaders(user), payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.json()).toEqual({ code: 'NOT_FOUND', message: 'Recurso no encontrado' });
    }
  });

  it('GET /config lo informa al frontend', async () => {
    ({ app } = await buildTestApp('detectionconfig', { featureFlags: 'detection=false' }));
    expect((await app.inject({ url: '/config' })).json().flags).toMatchObject({
      detection: false,
      'detection-llm': false,
    });
  });
});

describe('patrón de rutas', () => {
  it('cubre las de la 006 y no las parecidas de la 003', () => {
    const gate = GATED_PREFIXES.detection!;
    for (const [, url] of ROUTES) expect(gate.test(url), url).toBe(true);
    for (const url of [
      '/diagram-versions/66f3a1b2c3d4e5f601234567',
      '/diagram-versions/66f3a1b2c3d4e5f601234567/activities',
      '/diagram-versions/66f3a1b2c3d4e5f601234567/publish',
      '/proposalsx',
    ]) {
      expect(gate.test(url), url).toBe(false);
    }
  });
});

describe('detection activado (valor por defecto)', () => {
  it('GET /config lo informa', async () => {
    ({ app } = await buildTestApp('detectionon'));
    expect((await app.inject({ url: '/config' })).json().flags).toMatchObject({ detection: true });
  });
});
