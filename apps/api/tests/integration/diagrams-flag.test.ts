import { FLAGS } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';

// Constitución IV y plan ajuste 4: toda la feature 003 se integra detrás del flag `diagrams`.

const GATED = [
  '/projects/abc/diagrams',
  '/projects/abc/diagrams?x=1',
  '/diagrams/d1/versions',
  '/diagram-versions/v1',
  '/diagram-versions/v1/image/display',
  '/activities/a1',
];
const OPEN = ['/projects/abc', '/projects/abc/members', '/projects/abc/diagramas-no'];

async function appWithFlags(featureFlags: string): Promise<FastifyInstance> {
  const { app } = await buildTestApp('diagramsflag', { featureFlags });
  const paths = new Set([...GATED, ...OPEN].map((url) => url.split('?')[0]!));
  for (const path of paths) app.all(path, async () => ({ ruta: path }));
  await app.ready();
  return app;
}

describe('registro del flag', () => {
  it('diagrams está activado por defecto desde T059, es de la 003 y sustituye a diagram-editor', () => {
    expect(FLAGS.diagrams).toMatchObject({ default: true, owner: '003-diagramas-canvas' });
    expect(FLAGS).not.toHaveProperty('diagram-editor');
  });
});

describe('flag diagrams desactivado (FEATURE_FLAGS=diagrams=false)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await appWithFlags('diagrams=false');
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

describe('flag diagrams activado (valor por defecto)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await appWithFlags('');
  });
  afterAll(() => closeTestApp(app));

  it.each(GATED)('%s responde con normalidad', async (url) => {
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(200);
  });

  it('GET /config lo informa al frontend', async () => {
    expect((await app.inject({ url: '/config' })).json().flags).toMatchObject({ diagrams: true });
  });
});
