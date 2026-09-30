import { SessionSchema, SessionUserSchema } from '@reqcanvas/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTestApp, closeTestApp } from '../helpers/app';

// Contrato: specs/002-auth-proyectos/contracts/auth-projects.openapi.yaml (/auth/*, /me).
const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});

let app: FastifyInstance;
let counter = 0;

beforeAll(async () => {
  ({ app } = await buildTestApp('authcontract', { withAuth: true }));
  await app.ready();
});

afterAll(() => closeTestApp(app));

/** Cada petición desde una IP distinta: el rate limit no interfiere entre casos. */
const post = (url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: { 'x-real-ip': `198.51.100.${++counter % 250}`, ...headers },
  });

const newUser = () => ({
  name: 'Ana Pérez',
  email: `ana-${++counter}@example.com`,
  password: 'una-frase-larga',
});

/** Cookie `rt` de la respuesta, con sus atributos. */
function refreshCookie(response: LightMyRequestResponse) {
  return response.cookies.find((cookie) => cookie.name === 'rt');
}

describe('POST /auth/register', () => {
  it('201 con una Session y la cookie rt httpOnly; Secure; SameSite=Strict; Path=/api/auth', async () => {
    const response = await post('/auth/register', newUser());
    expect(response.statusCode).toBe(201);
    const session = SessionSchema.parse(response.json());
    expect(session.expiresIn).toBe(15 * 60);
    expect(session.user.name).toBe('Ana Pérez');

    const cookie = refreshCookie(response);
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60,
    });
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('400 con el formato de error y los campos inválidos', async () => {
    const response = await post('/auth/register', { name: '', email: 'x', password: 'corta' });
    expect(response.statusCode).toBe(400);
    const body = ErrorSchema.parse(response.json());
    expect(Object.keys(body.fields ?? {}).sort()).toEqual(['email', 'name', 'password']);
  });

  it('409 con el mensaje genérico si el email ya existe', async () => {
    const user = newUser();
    await post('/auth/register', user);
    const response = await post('/auth/register', { ...user, name: 'Otra' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 'REGISTRATION_FAILED',
      message: 'No se pudo crear la cuenta con esos datos',
    });
  });
});

describe('POST /auth/login', () => {
  it('200 con una Session y una cookie rt nueva', async () => {
    const user = newUser();
    await post('/auth/register', user);
    const response = await post('/auth/login', { email: user.email, password: user.password });
    expect(response.statusCode).toBe(200);
    SessionSchema.parse(response.json());
    expect(refreshCookie(response)?.value).toBeTruthy();
  });

  it('401 con el mensaje genérico', async () => {
    const response = await post('/auth/login', {
      email: 'nadie@example.com',
      password: 'una-frase-larga',
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Email o contraseña incorrectos',
    });
  });
});

describe('POST /auth/refresh y /auth/logout', () => {
  it('refresh: 200 con una Session nueva y rota la cookie', async () => {
    const registered = await post('/auth/register', newUser());
    const rt = refreshCookie(registered)!.value;
    const response = await post('/auth/refresh', undefined, { cookie: `rt=${rt}` });
    expect(response.statusCode).toBe(200);
    SessionSchema.parse(response.json());
    expect(refreshCookie(response)?.value).not.toBe(rt);
  });

  it('refresh sin cookie: 401 con el formato de error', async () => {
    const response = await post('/auth/refresh');
    expect(response.statusCode).toBe(401);
    ErrorSchema.parse(response.json());
  });

  it('logout: 204 y borra la cookie', async () => {
    const registered = await post('/auth/register', newUser());
    const rt = refreshCookie(registered)!.value;
    const response = await post('/auth/logout', undefined, { cookie: `rt=${rt}` });
    expect(response.statusCode).toBe(204);
    expect(refreshCookie(response)).toMatchObject({ value: '', path: '/api/auth' });
  });
});

describe('GET /me', () => {
  it('200 con el usuario (User) de la sesión', async () => {
    const user = newUser();
    const { accessToken } = (await post('/auth/register', user)).json();
    const response = await app.inject({
      url: '/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(SessionUserSchema.strict().parse(response.json())).toMatchObject({
      name: user.name,
      email: user.email,
    });
  });

  it('401 sin sesión', async () => {
    expect((await app.inject({ url: '/me' })).statusCode).toBe(401);
  });
});

describe('cookies en desarrollo', () => {
  it('sin Secure con secureCookies=false (Compose sirve por http)', async () => {
    const { app: dev } = await buildTestApp('authdev', { withAuth: { secureCookies: false } });
    await dev.ready();
    try {
      const response = await dev.inject({
        method: 'POST',
        url: '/auth/register',
        payload: newUser(),
      });
      expect(refreshCookie(response)?.secure).toBeFalsy();
    } finally {
      await closeTestApp(dev);
    }
  });
});
