import { FLAGS } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';

// Feature 006: el flag `detection` se retiró tras recorrerla en staging (constitución IV); queda
// `detection-llm`, un flag operativo para el refinamiento con Claude (coste).

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await closeTestApp(app);
  app = undefined;
});

describe('flags de la detección', () => {
  it('detection ya no existe; detection-llm sigue desactivado por defecto', () => {
    expect(FLAGS).not.toHaveProperty('detection');
    expect(FLAGS['detection-llm']).toMatchObject({
      default: false,
      owner: '006-deteccion-asistida',
    });
  });

  it('las rutas de la detección existen sin FEATURE_FLAGS (piden sesión, no responden 404)', async () => {
    ({ app } = await buildTestApp('detectionalways', { withAuth: true }));
    const response = await app.inject({
      url: '/diagram-versions/66f3a1b2c3d4e5f601234567/proposals',
    });
    expect(response.statusCode).toBe(401);
    expect(app.hasDecorator('detection')).toBe(true);
  });

  it('GET /config ya no informa detection', async () => {
    ({ app } = await buildTestApp('detectionconfig'));
    const flags = (await app.inject({ url: '/config' })).json().flags;
    expect(flags).not.toHaveProperty('detection');
    expect(flags).toMatchObject({ 'detection-llm': false });
  });
});
