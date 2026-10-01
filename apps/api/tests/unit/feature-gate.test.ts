import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandlers } from '../../src/lib/errors';
import type { ActiveFlags } from '../../src/lib/flags';
import { featureGatePlugin } from '../../src/plugins/flags';

// Constitución IV: con un flag desactivado, sus rutas responden 404 como si no existieran.
// `ejemplo` no es un flag del registro: el plugin recibe las rutas de cada flag como opción.

const gates = { ejemplo: /^\/ejemplo(\/|\?|$)/ };
let app: FastifyInstance;

async function appWith(flags: Record<string, boolean>) {
  app = Fastify();
  registerErrorHandlers(app);
  await app.register(featureGatePlugin, { flags: flags as ActiveFlags, gates });
  for (const url of ['/ejemplo', '/ejemplo/1', '/ejemplos', '/otra']) {
    app.get(url, async () => ({ ruta: url }));
  }
  await app.ready();
  return app;
}

afterEach(() => app?.close());

describe('featureGatePlugin', () => {
  it('con el flag desactivado, sus rutas responden 404', async () => {
    await appWith({ ejemplo: false });
    for (const url of ['/ejemplo', '/ejemplo/1', '/ejemplo?x=1']) {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: 'NOT_FOUND', message: 'Recurso no encontrado' });
    }
  });

  it('no toca rutas que solo empiezan igual ni las de otros', async () => {
    await appWith({ ejemplo: false });
    expect((await app.inject({ url: '/ejemplos' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/otra' })).statusCode).toBe(200);
  });

  it('con el flag activado, responden con normalidad', async () => {
    await appWith({ ejemplo: true });
    expect((await app.inject({ url: '/ejemplo/1' })).json()).toEqual({ ruta: '/ejemplo/1' });
  });

  it('expone los flags activos en app.flags', async () => {
    await appWith({ ejemplo: true });
    expect(app.flags).toEqual({ ejemplo: true });
  });
});
