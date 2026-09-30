import { FLAGS } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';

// Constitución IV: la feature 002 se integra en `main` por historias, detrás del flag
// `accounts` (análisis C1). Desactivado, sus rutas no existen para nadie.

const GATED = ['/auth/login', '/me', '/projects', '/projects/abc/members', '/invitations/tok'];
const OPEN = ['/health', '/version', '/config'];

async function appWithFlags(featureFlags: string): Promise<FastifyInstance> {
  const { app } = await buildTestApp('accountsflag', { featureFlags });
  for (const url of GATED) app.all(url, async () => ({ ruta: url }));
  await app.ready();
  return app;
}

describe('registro del flag', () => {
  it('accounts está registrado, desactivado por defecto y es de la 002', () => {
    expect(FLAGS).toHaveProperty('accounts');
    expect(FLAGS.accounts).toMatchObject({ default: false, owner: '002-auth-proyectos' });
    expect(FLAGS.accounts.description).not.toBe('');
  });
});

describe('flag accounts desactivado (valor por defecto)', () => {
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
    expect((await app.inject({ url })).statusCode).not.toBe(404);
  });

  it('GET /config informa del flag desactivado al frontend', async () => {
    expect((await app.inject({ url: '/config' })).json().flags).toMatchObject({ accounts: false });
  });
});

describe('flag accounts activado', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await appWithFlags('accounts=true');
  });
  afterAll(() => closeTestApp(app));

  it.each(GATED)('%s responde con normalidad', async (url) => {
    const response = await app.inject({ method: 'POST', url });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ruta: url });
  });

  it('GET /config informa del flag activado', async () => {
    expect((await app.inject({ url: '/config' })).json().flags).toMatchObject({ accounts: true });
  });
});
