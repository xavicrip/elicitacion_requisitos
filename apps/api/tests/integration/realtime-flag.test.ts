import { FLAGS } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { tryHandshake } from '../helpers/realtime';

// Constitución IV y plan de la 005, ajuste 2: Socket.IO atiende /socket.io/ fuera del router,
// así que el flag `realtime` decide si se monta el servidor, no `GATED_PREFIXES`.

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await closeTestApp(app);
  app = undefined;
});

describe('registro del flag', () => {
  it('realtime está desactivado por defecto y es de la 005', () => {
    expect(FLAGS.realtime).toMatchObject({
      default: false,
      owner: '005-colaboracion-tiempo-real',
    });
  });
});

describe('flag realtime desactivado (valor por defecto)', () => {
  it('no se monta el servidor: /socket.io/ no acepta el handshake', async () => {
    ({ app } = await buildTestApp('realtimeoff'));
    const url = await app.listen({ port: 0, host: '127.0.0.1' });
    expect(await tryHandshake(url)).not.toBe('connected');
  });

  it('GET /config lo informa al frontend', async () => {
    ({ app } = await buildTestApp('realtimeconfig'));
    expect((await app.inject({ url: '/config' })).json().flags).toMatchObject({ realtime: false });
  });
});
