import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi } from './helpers/api';

const user = { id: 'u1', name: 'Ana', email: 'ana@example.com' };
const project = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Tienda en línea',
  description: 'Ventas por internet',
  status: 'draft',
  myRole: 'admin',
  lastActivityAt: '2026-09-30T10:00:00.000Z',
  memberCount: 1,
  createdAt: '2026-09-30T09:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  useAuthStore.getState().setSession({ accessToken: 'token-1', expiresIn: 900, user });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('"Mis proyectos" (FR-012)', () => {
  it('lista los proyectos con su estado y el rol del usuario', async () => {
    mockApi({
      'GET /api/projects': () =>
        json(200, [
          project({ status: 'open' }),
          project({ id: 'p2', name: 'Intranet', status: 'closed', myRole: 'participant' }),
        ]),
    });
    renderAt('/proyectos');
    const first = (await screen.findByRole('link', { name: /Tienda en línea/ })).closest('li')!;
    expect(first).toHaveTextContent('Abierto');
    expect(first).toHaveTextContent('Administrador');
    const second = screen.getByRole('link', { name: /Intranet/ }).closest('li')!;
    expect(second).toHaveTextContent('Cerrado');
    expect(second).toHaveTextContent('Participante');
    expect(screen.getByRole('link', { name: /Tienda en línea/ })).toHaveAttribute(
      'href',
      '/proyectos/p1',
    );
  });

  it('sin proyectos muestra el estado vacío', async () => {
    mockApi({ 'GET /api/projects': () => json(200, []) });
    renderAt('/proyectos');
    expect(await screen.findByText('Todavía no tienes proyectos.')).toBeInTheDocument();
  });

  it('crea un proyecto y abre su página (US2 escenario 1)', async () => {
    const { requests } = mockApi({
      'GET /api/projects': () => json(200, []),
      'POST /api/projects': () => json(201, project()),
      'GET /api/projects/p1': () => json(200, project()),
    });
    const router = renderAt('/proyectos');
    await userEvent.type(await screen.findByLabelText('Nombre del proyecto'), 'Tienda en línea');
    await userEvent.type(screen.getByLabelText('Descripción'), 'Ventas por internet');
    await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/proyectos/p1'));
    expect(requests.find((r) => r.method === 'POST')?.body).toEqual({
      name: 'Tienda en línea',
      description: 'Ventas por internet',
    });
    expect(await screen.findByRole('heading', { name: 'Tienda en línea' })).toBeInTheDocument();
  });

  it('el nombre del proyecto es obligatorio', async () => {
    mockApi({ 'GET /api/projects': () => json(200, []) });
    renderAt('/proyectos');
    await userEvent.click(await screen.findByRole('button', { name: 'Crear proyecto' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('XSS (constitución V)', () => {
  it('un nombre o una descripción con <script> se muestran como texto', async () => {
    const evil = '<script>alert("xss")</script>';
    mockApi({
      'GET /api/projects': () => json(200, [project({ name: evil })]),
      'GET /api/projects/p1': () =>
        json(200, project({ name: evil, description: `<img src=x onerror=alert(1)>` })),
    });
    renderAt('/proyectos');
    expect(await screen.findByText(evil)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();

    renderAt('/proyectos/p1');
    expect(await screen.findByRole('heading', { name: evil })).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('página del proyecto (Administrador)', () => {
  it('edita el nombre y la descripción', async () => {
    const { requests } = mockApi({
      'GET /api/projects/p1': [
        () => json(200, project()),
        () => json(200, project({ description: 'Nueva' })),
      ],
      'PATCH /api/projects/p1': () => json(200, project({ description: 'Nueva' })),
    });
    renderAt('/proyectos/p1');
    const description = await screen.findByLabelText('Descripción');
    await userEvent.clear(description);
    await userEvent.type(description, 'Nueva');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Cambios guardados');
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({
      name: 'Tienda en línea',
      description: 'Nueva',
    });
  });

  it('cambia el estado: Abrir, Cerrar y Reabrir según el estado actual (FR-006)', async () => {
    const { handlers, requests } = mockApi({
      'GET /api/projects/p1': () => json(200, project()),
      'POST /api/projects/p1/status': () => json(200, project({ status: 'open' })),
    });
    renderAt('/proyectos/p1');
    expect(await screen.findByText('Borrador')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cerrar proyecto' })).not.toBeInTheDocument();

    handlers['GET /api/projects/p1'] = () => json(200, project({ status: 'open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Abrir proyecto' }));
    expect(await screen.findByText('Abierto')).toBeInTheDocument();
    expect(requests.find((r) => r.url === '/api/projects/p1/status')?.body).toEqual({
      action: 'open',
    });
    expect(screen.getByRole('button', { name: 'Cerrar proyecto' })).toBeInTheDocument();
  });

  it('muestra el error de una transición rechazada', async () => {
    mockApi({
      'GET /api/projects/p1': () => json(200, project()),
      'POST /api/projects/p1/status': () =>
        json(409, {
          code: 'INVALID_TRANSITION',
          message: 'No se puede abrir un proyecto en estado abierto.',
        }),
    });
    renderAt('/proyectos/p1');
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir proyecto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se puede abrir');
  });

  it('si la sesión caduca al guardar, se renueva y el texto editado no se pierde', async () => {
    const { requests } = mockApi({
      'GET /api/projects/p1': () => json(200, project()),
      'PATCH /api/projects/p1': [
        () => json(401, { code: 'UNAUTHORIZED', message: 'Inicia sesión para continuar.' }),
        () => json(200, project({ description: 'Texto largo que no se debe perder' })),
      ],
      'POST /api/auth/refresh': () => json(200, { accessToken: 'token-2', expiresIn: 900, user }),
    });
    renderAt('/proyectos/p1');
    const description = await screen.findByLabelText('Descripción');
    await userEvent.clear(description);
    await userEvent.type(description, 'Texto largo que no se debe perder');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Cambios guardados');
    const patches = requests.filter((r) => r.method === 'PATCH');
    expect(patches.map((p) => p.auth)).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(patches[1]?.body).toMatchObject({ description: 'Texto largo que no se debe perder' });
    expect(screen.getByLabelText('Descripción')).toHaveValue('Texto largo que no se debe perder');
  });
});

describe('DeleteProjectDialog (US2 escenario 4)', () => {
  it('solo permite eliminar al escribir el nombre exacto', async () => {
    const { requests } = mockApi({
      'GET /api/projects/p1': () => json(200, project()),
      'DELETE /api/projects/p1': () => new Response(null, { status: 202 }),
      'GET /api/projects': () => json(200, []),
    });
    const router = renderAt('/proyectos/p1');
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar proyecto' }));
    const dialog = await screen.findByRole('dialog', { name: 'Eliminar proyecto' });
    const confirm = within(dialog).getByRole('button', { name: 'Eliminar definitivamente' });
    expect(confirm).toBeDisabled();

    const input = within(dialog).getByLabelText(/Escribe .*Tienda en línea.* para confirmar/);
    await userEvent.type(input, 'tienda en linea');
    expect(confirm).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'Tienda en línea');
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);
    await waitFor(() => expect(router.state.location.pathname).toBe('/proyectos'));
    expect(requests.find((r) => r.method === 'DELETE')?.body).toEqual({
      confirmName: 'Tienda en línea',
    });
  });

  it('cancelar cierra el diálogo sin eliminar', async () => {
    const { requests } = mockApi({ 'GET /api/projects/p1': () => json(200, project()) });
    renderAt('/proyectos/p1');
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar proyecto' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
  });
});
