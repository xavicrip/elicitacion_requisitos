import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi } from './helpers/api';

// US4: la interfaz no es la única barrera (la API lo verifica siempre), pero no debe ofrecer
// acciones que el rol no permite ni revelar si existe un proyecto ajeno.

const user = { id: 'u2', name: 'Luis', email: 'luis@example.com' };
const project = (myRole: 'admin' | 'participant') => ({
  id: 'p1',
  name: 'Tienda en línea',
  description: 'Ventas por internet',
  status: 'open',
  myRole,
  lastActivityAt: '2026-09-30T10:00:00.000Z',
  memberCount: 2,
  createdAt: '2026-09-30T09:00:00.000Z',
});

beforeEach(() => {
  useAuthStore.getState().setSession({ accessToken: 'token-luis', expiresIn: 900, user });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

function renderAt(path: string) {
  render(
    <AppProviders>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AppProviders>,
  );
}

describe('proyecto inexistente o ajeno (US4 escenario 1)', () => {
  it('muestra "Proyecto no encontrado" y lleva de vuelta a "Mis proyectos"', async () => {
    mockApi({
      'GET /api/projects/ajeno': () =>
        json(404, { code: 'NOT_FOUND', message: 'Proyecto no encontrado' }),
    });
    renderAt('/proyectos/ajeno');
    expect(
      await screen.findByRole('heading', { name: 'Proyecto no encontrado' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a Mis proyectos' })).toHaveAttribute(
      'href',
      '/proyectos',
    );
  });

  it('no reintenta un 404: se muestra de inmediato', async () => {
    const { requests } = mockApi({
      'GET /api/projects/ajeno': () =>
        json(404, { code: 'NOT_FOUND', message: 'Proyecto no encontrado' }),
    });
    renderAt('/proyectos/ajeno');
    await screen.findByRole('heading', { name: 'Proyecto no encontrado' });
    expect(requests.filter((r) => r.url === '/api/projects/ajeno')).toHaveLength(1);
  });
});

describe('participante (US4 escenario 2)', () => {
  it('ve el proyecto pero no las acciones de administración', async () => {
    mockApi({ 'GET /api/projects/p1': () => json(200, project('participant')) });
    renderAt('/proyectos/p1');
    expect(await screen.findByRole('heading', { name: 'Tienda en línea' })).toBeInTheDocument();
    expect(screen.getByText('Ventas por internet')).toBeInTheDocument();
    expect(screen.getByText('Participante')).toBeInTheDocument();

    for (const name of ['Cerrar proyecto', 'Guardar cambios', 'Eliminar proyecto']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('el Administrador sí ve esas acciones', async () => {
    mockApi({ 'GET /api/projects/p1': () => json(200, project('admin')) });
    renderAt('/proyectos/p1');
    expect(await screen.findByRole('button', { name: 'Cerrar proyecto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar proyecto' })).toBeInTheDocument();
  });
});
