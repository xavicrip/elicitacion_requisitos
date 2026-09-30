import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, refreshSession } from '../src/lib/api-client';
import { useAuthStore } from '../src/lib/auth-store';

const user = { id: 'u1', name: 'Ana', email: 'ana@example.com' };
const session = (token: string) => ({ accessToken: token, expiresIn: 900, user });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  useAuthStore.getState().clear();
});

afterEach(() => vi.unstubAllGlobals());

const calls = () =>
  (fetchMock.mock.calls as Array<[string, RequestInit]>).map(([url, init]) => ({
    url,
    method: init.method,
    auth: new Headers(init.headers).get('authorization'),
  }));

describe('apiFetch (research R10)', () => {
  it('usa rutas relativas /api, JSON y el access token en memoria', async () => {
    useAuthStore.getState().setSession(session('token-1'));
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));

    await expect(
      apiFetch('/projects', { method: 'POST', body: { name: 'Tienda' } }),
    ).resolves.toEqual({
      ok: true,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/projects');
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token-1');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'Tienda' }));
  });

  it('sin sesión no envía Authorization', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await apiFetch('/invitations/abc');
    expect(calls()[0]?.auth).toBeNull();
  });

  it('una respuesta 204 devuelve undefined', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('tras un 401 refresca la sesión con la cookie y reintenta una vez', async () => {
    useAuthStore.getState().setSession(session('caducado'));
    fetchMock
      .mockResolvedValueOnce(json(401, { code: 'UNAUTHORIZED', message: 'Inicia sesión' }))
      .mockResolvedValueOnce(json(200, session('nuevo')))
      .mockResolvedValueOnce(json(200, { ok: true }));

    await expect(apiFetch('/me')).resolves.toEqual({ ok: true });
    expect(calls()).toEqual([
      { url: '/api/me', method: 'GET', auth: 'Bearer caducado' },
      { url: '/api/auth/refresh', method: 'POST', auth: null },
      { url: '/api/me', method: 'GET', auth: 'Bearer nuevo' },
    ]);
    expect(useAuthStore.getState().accessToken).toBe('nuevo');
  });

  it('las peticiones concurrentes que reciben 401 comparten un solo refresh', async () => {
    useAuthStore.getState().setSession(session('caducado'));
    let refreshes = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url === '/api/auth/refresh') {
        refreshes += 1;
        return json(200, session('nuevo'));
      }
      const auth = new Headers(init.headers).get('authorization');
      return auth === 'Bearer nuevo' ? json(200, { url }) : json(401, { code: 'UNAUTHORIZED' });
    });

    const results = await Promise.all([apiFetch('/a'), apiFetch('/b'), apiFetch('/c')]);
    expect(results).toEqual([{ url: '/api/a' }, { url: '/api/b' }, { url: '/api/c' }]);
    expect(refreshes).toBe(1);
  });

  it('si el refresh falla, borra la sesión y lanza un 401 sin volver a reintentar', async () => {
    useAuthStore.getState().setSession(session('caducado'));
    fetchMock
      .mockResolvedValueOnce(json(401, { code: 'UNAUTHORIZED', message: 'Inicia sesión' }))
      .mockResolvedValueOnce(json(401, { code: 'UNAUTHORIZED', message: 'Inicia sesión' }));

    const error = await apiFetch('/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState()).toMatchObject({ accessToken: null, user: null });
  });

  it('no intenta refrescar en las rutas de autenticación', async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, { code: 'INVALID_CREDENTIALS', message: 'Email o contraseña incorrectos' }),
    );
    await expect(apiFetch('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 401,
      message: 'Email o contraseña incorrectos',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('convierte los errores del contrato en ApiError con code, message y fields', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, {
        code: 'VALIDATION_ERROR',
        message: 'Revisa los datos del formulario.',
        fields: { name: 'Demasiado largo' },
      }),
    );
    await expect(apiFetch('/projects', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Revisa los datos del formulario.',
      fields: { name: 'Demasiado largo' },
    });
  });

  it('un error sin cuerpo JSON (proxy caído) da un mensaje genérico en español', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));
    await expect(apiFetch('/projects')).rejects.toMatchObject({
      status: 502,
      code: 'NETWORK_ERROR',
      message: 'No se pudo conectar con el servidor. Inténtalo de nuevo.',
    });
  });
});

describe('refreshSession', () => {
  it('guarda la sesión devuelta y responde true', async () => {
    fetchMock.mockResolvedValueOnce(json(200, session('t')));
    await expect(refreshSession()).resolves.toBe(true);
    expect(useAuthStore.getState()).toMatchObject({ accessToken: 't', user });
  });

  it('sin cookie válida responde false y deja la sesión vacía', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { code: 'UNAUTHORIZED' }));
    await expect(refreshSession()).resolves.toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
