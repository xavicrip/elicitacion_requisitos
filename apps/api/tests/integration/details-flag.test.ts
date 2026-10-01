import { FLAGS } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';

// Constitución IV y plan ajuste 2: toda la feature 004 se integra detrás del flag `details`.

const GATED = [
  '/diagrams/d1/activities/k1/details',
  '/diagrams/d1/activities/k1/details?sort=votes',
  '/details/x1',
  '/details/x1/vote',
  '/details/x1/comments',
  '/comments/c1',
  '/diagram-versions/v1/coverage',
  '/projects/p1/details/facets',
  '/projects/p1/details/orphans',
];
// Rutas de la 002 y la 003 que el flag no debe tocar.
const OPEN = [
  '/projects/p1',
  '/projects/p1/diagrams',
  '/diagram-versions/v1',
  '/diagram-versions/v1/image/display',
  '/activities/a1',
  '/diagrams/d1/versions',
];

async function appWithFlags(featureFlags: string): Promise<FastifyInstance> {
  const { app } = await buildTestApp('detailsflag', { featureFlags });
  const paths = new Set([...GATED, ...OPEN].map((url) => url.split('?')[0]!));
  for (const path of paths) app.all(path, async () => ({ ruta: path }));
  await app.ready();
  return app;
}

describe('registro del flag', () => {
  it('details está desactivado por defecto, es de la 004 y sustituye a coverage-overlay', () => {
    expect(FLAGS.details).toMatchObject({ default: false, owner: '004-detalles-requisitos' });
    expect(FLAGS).not.toHaveProperty('coverage-overlay');
  });
});

describe('flag details desactivado (valor por defecto)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await appWithFlags('');
  });
  afterAll(() => closeTestApp(app));

  it.each(GATED)('%s responde 404 como si no existiera', async (url) => {
    const response = await app.inject({ method: 'POST', url });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'NOT_FOUND', message: 'Recurso no encontrado' });
  });

  it.each(OPEN)('%s sigue disponible', async (url) => {
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(200);
  });
});

describe('flag details activado', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await appWithFlags('details=true');
  });
  afterAll(() => closeTestApp(app));

  it.each(GATED)('%s responde con normalidad', async (url) => {
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(200);
  });

  it('GET /config lo informa al frontend', async () => {
    expect((await app.inject({ url: '/config' })).json().flags).toMatchObject({ details: true });
  });
});
