import { Writable } from 'node:stream';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditLogsModel } from '../../src/modules/audit/model';
import { refreshTokensModel } from '../../src/modules/auth/refresh-token.model';
import { usersModel } from '../../src/modules/users/model';
import { buildTestApp, closeTestApp } from '../helpers/app';

const logs: string[] = [];
let app: FastifyInstance;
let counter = 0;

beforeAll(async () => {
  ({ app } = await buildTestApp('auth', {
    withAuth: true,
    logStream: new Writable({
      write(chunk, _encoding, done) {
        logs.push(String(chunk));
        done();
      },
    }),
  }));
  await app.ready();
});

afterAll(() => closeTestApp(app));

const newUser = () => ({
  name: 'Ana',
  email: `ana-${++counter}-${Date.now()}@example.com`,
  password: 'una-frase-larga',
});
const ip = () => `203.0.113.${++counter % 250}`;

const post = (url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: { 'x-real-ip': ip(), ...headers },
  });

const rtOf = (response: LightMyRequestResponse) =>
  response.cookies.find((cookie) => cookie.name === 'rt')?.value ?? '';

const refresh = (rt: string) => post('/auth/refresh', undefined, { cookie: `rt=${rt}` });

describe('registro (US1, FR-001, FR-002)', () => {
  it('crea la cuenta con el email normalizado y el hash argon2id', async () => {
    const user = newUser();
    const response = await post('/auth/register', { ...user, email: user.email.toUpperCase() });
    expect(response.statusCode).toBe(201);
    const stored = await usersModel(app.mongo)
      .findOne({ email: user.email })
      .select('+passwordHash');
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(response.json().user).toMatchObject({
      id: stored?._id.toHexString(),
      email: user.email,
    });
  });

  it('rechaza una contraseña común con el error en el campo password', async () => {
    const response = await post('/auth/register', { ...newUser(), password: 'basketball' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { password: 'Esa contraseña es demasiado común. Elige otra.' },
    });
  });

  it('un email duplicado responde 409 genérico y tarda lo mismo que un registro (research R5)', async () => {
    const user = newUser();
    let started = performance.now();
    await post('/auth/register', user);
    const firstMs = performance.now() - started;

    started = performance.now();
    const duplicate = await post('/auth/register', { ...user, name: 'Otra persona' });
    const duplicateMs = performance.now() - started;

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.body).not.toContain(user.email);
    // Sin el hash ficticio, el duplicado respondería en ~1 ms frente a los ~50 ms de argon2id.
    expect(duplicateMs).toBeGreaterThan(firstMs * 0.4);
  });
});

describe('login y bloqueo (FR-004, research R4)', () => {
  it('inicia sesión y actualiza lastLoginAt', async () => {
    const user = newUser();
    await post('/auth/register', user);
    const response = await post('/auth/login', { email: user.email, password: user.password });
    expect(response.statusCode).toBe(200);
    const stored = await usersModel(app.mongo).findOne({ email: user.email });
    expect(stored?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('los fallos 1–5 responden 401 y desde el 6.º, 429 con Retry-After de 15 min', async () => {
    const user = newUser();
    await post('/auth/register', user);
    const attempt = (password: string) => post('/auth/login', { email: user.email, password });

    for (let i = 1; i <= 5; i++) expect((await attempt('incorrecta-123')).statusCode).toBe(401);
    const blocked = await attempt('incorrecta-123');
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(14 * 60);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(15 * 60);
    expect(blocked.json()).toMatchObject({
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Demasiados intentos, espera 15 minutos',
    });
    // Bloqueada: ni siquiera la contraseña correcta entra hasta que pase el tiempo.
    expect((await attempt(user.password)).statusCode).toBe(429);
  });

  it('el bloqueo por origen: 5 fallos desde una IP con emails distintos bloquean esa IP', async () => {
    const attacker = '192.0.2.77';
    for (let i = 0; i < 5; i++) {
      const response = await post(
        '/auth/login',
        { email: `victima-${i}@example.com`, password: 'probando-1234' },
        { 'x-real-ip': attacker },
      );
      expect(response.statusCode).toBe(401);
    }
    const user = newUser();
    await post('/auth/register', user);
    const fromAttacker = await post(
      '/auth/login',
      { email: user.email, password: user.password },
      { 'x-real-ip': attacker },
    );
    expect(fromAttacker.statusCode).toBe(429);
    // La misma cuenta entra desde otro origen: el bloqueo es por IP, no global.
    expect(
      (await post('/auth/login', { email: user.email, password: user.password })).statusCode,
    ).toBe(200);
  });

  it('registra auth.login_failed en auditoría sin datos sensibles', async () => {
    const email = `fallo-${Date.now()}@example.com`;
    await post('/auth/login', { email, password: 'contraseña-que-no-es' });
    const events = await auditLogsModel(app.mongo).find({ action: 'auth.login_failed' }).lean();
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(email);
    expect(JSON.stringify(events)).not.toContain('contraseña-que-no-es');
  });

  it('un login correcto reinicia el contador de la cuenta', async () => {
    const user = newUser();
    await post('/auth/register', user);
    for (let i = 0; i < 4; i++)
      await post('/auth/login', { email: user.email, password: 'mal-mal-mal' });
    expect(
      (await post('/auth/login', { email: user.email, password: user.password })).statusCode,
    ).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect(
        (await post('/auth/login', { email: user.email, password: 'mal-mal-mal' })).statusCode,
      ).toBe(401);
    }
  });
});

describe('refresh con rotación y detección de reutilización (research R1)', () => {
  it('rota el token: el anterior queda marcado y el nuevo funciona', async () => {
    const rt1 = rtOf(await post('/auth/register', newUser()));
    const second = await refresh(rt1);
    expect(second.statusCode).toBe(200);
    const rt2 = rtOf(second);
    expect(rt2).not.toBe(rt1);
    expect((await refresh(rt2)).statusCode).toBe(200);
  });

  it('reutilizar un token ya rotado revoca toda la familia de sesión', async () => {
    const rt1 = rtOf(await post('/auth/register', newUser()));
    const rt2 = rtOf(await refresh(rt1));

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // Pasado el margen de carrera entre pestañas (10 s), la reutilización es un robo.
      vi.setSystemTime(Date.now() + 60_000);
      expect((await refresh(rt1)).statusCode).toBe(401);
      expect((await refresh(rt2)).statusCode).toBe(401);
    } finally {
      vi.useRealTimers();
    }
    const events = await auditLogsModel(app.mongo).find({ action: 'auth.refresh_reused' }).lean();
    expect(events.length).toBeGreaterThan(0);
  });

  it('dos pestañas que refrescan a la vez no revocan la sesión (margen de 10 s)', async () => {
    const rt1 = rtOf(await post('/auth/register', newUser()));
    const [a, b] = await Promise.all([refresh(rt1), refresh(rt1)]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 401]);
    const winner = a.statusCode === 200 ? a : b;
    expect((await refresh(rtOf(winner))).statusCode).toBe(200);
  });

  it('un token caducado o inventado responde 401', async () => {
    expect((await refresh('no-existe')).statusCode).toBe(401);
    const rt = rtOf(await post('/auth/register', newUser()));
    await refreshTokensModel(app.mongo).updateMany({}, { $set: { expiresAt: new Date(0) } });
    expect((await refresh(rt)).statusCode).toBe(401);
  });
});

describe('logout (US1 escenario 4)', () => {
  it('revoca la sesión: el refresh deja de funcionar', async () => {
    const rt = rtOf(await post('/auth/register', newUser()));
    expect((await post('/auth/logout', undefined, { cookie: `rt=${rt}` })).statusCode).toBe(204);
    expect((await refresh(rt)).statusCode).toBe(401);
  });

  it('sin cookie también responde 204 (idempotente)', async () => {
    expect((await post('/auth/logout')).statusCode).toBe(204);
  });
});

describe('secretos', () => {
  it('passwordHash, contraseñas y tokens no aparecen en respuestas ni en logs', async () => {
    const user = newUser();
    logs.length = 0;
    const registered = await post('/auth/register', user);
    const rt = rtOf(registered);
    const bodies = [
      registered.body,
      (await post('/auth/login', { email: user.email, password: user.password })).body,
      (await refresh(rt)).body,
    ].join('');
    expect(bodies).not.toMatch(/argon2|passwordHash/);
    const logText = logs.join('');
    expect(logText).not.toContain(user.password);
    expect(logText).not.toContain(rt);
    expect(logText).not.toMatch(/\$argon2id\$/);
  });
});
