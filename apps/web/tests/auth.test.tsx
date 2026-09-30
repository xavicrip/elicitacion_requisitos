import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { useAuthStore } from '../src/lib/auth-store';

type Handler = (init: RequestInit) => Response | Promise<Response>;

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const user = { id: 'u1', name: 'Ana Pérez', email: 'ana@example.com' };
const session = { accessToken: 'token-1', expiresIn: 900, user };

let handlers: Record<string, Handler>;
let requests: Array<{ url: string; method: string; body?: unknown }>;

/** API simulada: responde según "MÉTODO /ruta"; por defecto `accounts` activado y sin sesión. */
beforeEach(() => {
  useAuthStore.getState().clear();
  requests = [];
  handlers = {
    'GET /api/config': () => json(200, { flags: { accounts: true } }),
    'POST /api/auth/refresh': () => json(401, { code: 'SESSION_EXPIRED', message: 'Caducada' }),
    'GET /api/projects': () => json(200, []),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      requests.push({
        url,
        method,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      const handler = handlers[`${method} ${url}`];
      return handler ? handler(init) : json(404, { code: 'NOT_FOUND', message: 'No' });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('registro (US1 escenario 1)', () => {
  it('valida con los esquemas compartidos y muestra los errores en español', async () => {
    renderAt('/registro');
    await userEvent.click(await screen.findByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText(/nombre/i, { selector: '[role="alert"]' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Contraseña'), 'corta');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(
      await screen.findByText(/al menos 10 caracteres/, { selector: '[role="alert"]' }),
    ).toBeInTheDocument();
    expect(requests.some((r) => r.url === '/api/auth/register')).toBe(false);
  });

  it('crea la cuenta, inicia la sesión y lleva a "Mis proyectos" vacío', async () => {
    handlers['POST /api/auth/register'] = () => json(201, session);
    const router = renderAt('/registro');
    await userEvent.type(await screen.findByLabelText('Nombre'), 'Ana Pérez');
    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'una-frase-larga');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByRole('heading', { name: 'Mis proyectos' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/proyectos');
    // La lista llega después del título: hay que esperarla (en el CI tarda más que en local).
    expect(await screen.findByText('Todavía no tienes proyectos.')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('Ana Pérez');
    expect(requests.find((r) => r.url === '/api/auth/register')?.body).toEqual({
      name: 'Ana Pérez',
      email: 'ana@example.com',
      password: 'una-frase-larga',
    });
  });

  it('un email ya registrado muestra el mensaje genérico (US1 escenario 2)', async () => {
    handlers['POST /api/auth/register'] = () =>
      json(409, {
        code: 'REGISTRATION_FAILED',
        message: 'No se pudo crear la cuenta con esos datos',
      });
    renderAt('/registro');
    await userEvent.type(await screen.findByLabelText('Nombre'), 'Ana');
    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'una-frase-larga');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo crear la cuenta con esos datos',
    );
  });

  it('muestra en su campo el error de la API (contraseña común)', async () => {
    handlers['POST /api/auth/register'] = () =>
      json(400, {
        code: 'VALIDATION_ERROR',
        message: 'Revisa los datos del formulario.',
        fields: { password: 'Esa contraseña es demasiado común. Elige otra.' },
      });
    renderAt('/registro');
    await userEvent.type(await screen.findByLabelText('Nombre'), 'Ana');
    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'basketball');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(
      await screen.findByText('Esa contraseña es demasiado común. Elige otra.'),
    ).toBeInTheDocument();
  });
});

describe('inicio de sesión', () => {
  const fillLogin = async (password = 'una-frase-larga') => {
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), password);
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  };

  it('inicia sesión y vuelve a la página que se pidió', async () => {
    handlers['POST /api/auth/login'] = () => json(200, session);
    const router = renderAt('/entrar?redirect=%2Fproyectos');
    await fillLogin();
    await waitFor(() => expect(router.state.location.pathname).toBe('/proyectos'));
    expect(useAuthStore.getState().accessToken).toBe('token-1');
  });

  it('credenciales incorrectas: mensaje genérico', async () => {
    handlers['POST /api/auth/login'] = () =>
      json(401, { code: 'INVALID_CREDENTIALS', message: 'Email o contraseña incorrectos' });
    renderAt('/entrar');
    await fillLogin('incorrecta-123');
    expect(await screen.findByRole('alert')).toHaveTextContent('Email o contraseña incorrectos');
  });

  it('bloqueo tras 5 intentos: muestra el aviso (US1 escenario 3)', async () => {
    handlers['POST /api/auth/login'] = () =>
      json(429, { code: 'TOO_MANY_ATTEMPTS', message: 'Demasiados intentos, espera 15 minutos' });
    renderAt('/entrar');
    await fillLogin('incorrecta-123');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Demasiados intentos, espera 15 minutos',
    );
  });
});

describe('sesión y rutas protegidas', () => {
  it('sin sesión, una ruta protegida lleva a /entrar recordando la página', async () => {
    const router = renderAt('/proyectos');
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?redirect=%2Fproyectos');
  });

  it('al recargar, recupera la sesión con la cookie (refresh) sin pedir login', async () => {
    handlers['POST /api/auth/refresh'] = () => json(200, session);
    renderAt('/proyectos');
    expect(await screen.findByRole('heading', { name: 'Mis proyectos' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('Ana Pérez');
  });

  it('cerrar sesión revoca la sesión y lleva a /entrar (US1 escenario 4)', async () => {
    handlers['POST /api/auth/refresh'] = () => json(200, session);
    handlers['POST /api/auth/logout'] = () => json(204);
    const router = renderAt('/proyectos');
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(requests.some((r) => r.method === 'POST' && r.url === '/api/auth/logout')).toBe(true);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});

describe('flag accounts desactivado', () => {
  it.each(['/entrar', '/registro', '/proyectos'])(
    '%s muestra "Página no encontrada"',
    async (path) => {
      handlers['GET /api/config'] = () => json(200, { flags: { accounts: false } });
      renderAt(path);
      expect(
        await screen.findByRole('heading', { name: 'Página no encontrada' }),
      ).toBeInTheDocument();
    },
  );

  it('la cabecera no muestra enlaces de acceso', async () => {
    handlers['GET /api/config'] = () => json(200, { flags: { accounts: false } });
    renderAt('/');
    await screen.findByRole('heading', { name: 'ReqCanvas', level: 1 });
    expect(screen.queryByRole('link', { name: 'Iniciar sesión' })).not.toBeInTheDocument();
  });
});
