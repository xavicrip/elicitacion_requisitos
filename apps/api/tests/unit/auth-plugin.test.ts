import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { currentUserId } from '../../src/lib/request-context';
import { authPlugin } from '../../src/plugins/auth';

const SECRET = 'secreto-de-prueba-de-al-menos-32-bytes!!';
const logs: string[] = [];
let app: FastifyInstance;
let seenInContext: string | undefined;

async function appWith(secret: string, logStream?: Writable) {
  const instance = await buildApp({ logLevel: 'info', logStream });
  await instance.register(authPlugin, { secret, accessTtl: '15m' });
  instance.get('/privado', { preHandler: instance.requireAuth }, async (request) => {
    request.log.info('dentro de la ruta');
    seenInContext = currentUserId();
    return { id: request.user.id, sid: request.user.sid };
  });
  await instance.ready();
  return instance;
}

beforeAll(async () => {
  app = await appWith(
    SECRET,
    new Writable({
      write(chunk, _encoding, done) {
        logs.push(String(chunk));
        done();
      },
    }),
  );
});

afterAll(() => app.close());

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('plugin de autenticación (research R1)', () => {
  it('firma access tokens HS256 de 15 minutos con sub y sid', async () => {
    const token = app.signAccessToken('user-1', 'sid-1');
    const payload = app.jwt.decode<{ sub: string; sid: string; iat: number; exp: number }>(token);
    expect(payload).toMatchObject({ sub: 'user-1', sid: 'sid-1' });
    expect(payload!.exp - payload!.iat).toBe(15 * 60);
    expect(JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString())).toMatchObject({
      alg: 'HS256',
    });
  });

  it('requireAuth deja pasar un token válido y expone request.user', async () => {
    const response = await app.inject({
      url: '/privado',
      headers: bearer(app.signAccessToken('user-1', 'sid-1')),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'user-1', sid: 'sid-1' });
  });

  it('añade el userId al log de la petición y al contexto', async () => {
    logs.length = 0;
    await app.inject({ url: '/privado', headers: bearer(app.signAccessToken('user-42', 's')) });
    const line = logs.map((l) => JSON.parse(l)).find((l) => l.msg === 'dentro de la ruta');
    expect(line).toMatchObject({ userId: 'user-42' });
    expect(seenInContext).toBe('user-42');
  });

  it.each([
    ['sin cabecera', {}],
    ['con un esquema distinto de Bearer', { authorization: 'Basic abc' }],
    ['con un token mal formado', { authorization: 'Bearer no-es-un-jwt' }],
  ])('responde 401 %s', async (_caso, headers) => {
    const response = await app.inject({ url: '/privado', headers });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Inicia sesión para continuar.',
    });
  });

  it('responde 401 con un token caducado', async () => {
    const token = app.signAccessToken('user-1', 'sid-1');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 16 * 60 * 1000);
      const response = await app.inject({ url: '/privado', headers: bearer(token) });
      expect(response.statusCode).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it('responde 401 con un token firmado con otro secreto', async () => {
    const other = await appWith('otro-secreto-distinto-de-al-menos-32-bytes');
    const forged = other.signAccessToken('user-1', 'sid-1');
    await other.close();
    const response = await app.inject({ url: '/privado', headers: bearer(forged) });
    expect(response.statusCode).toBe(401);
  });

  it('rechaza un token con alg none', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'user-1', sid: 'x' })).toString('base64url');
    const response = await app.inject({ url: '/privado', headers: bearer(`${header}.${body}.`) });
    expect(response.statusCode).toBe(401);
  });
});
