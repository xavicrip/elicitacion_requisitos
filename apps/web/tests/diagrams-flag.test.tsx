import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi } from './helpers/api';

// Plan ajuste 4: con `diagrams` desactivado, web no muestra la sección de diagramas.

const project = {
  id: 'p1',
  name: 'Tienda en línea',
  description: '',
  status: 'draft',
  myRole: 'admin',
  lastActivityAt: '2026-09-30T10:00:00.000Z',
  memberCount: 1,
  createdAt: '2026-09-30T09:00:00.000Z',
};

beforeEach(() => {
  useAuthStore.getState().setSession({
    accessToken: 'token-1',
    expiresIn: 900,
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

function renderProject(flags: Record<string, boolean>) {
  mockApi({
    'GET /api/config': () => json(200, { flags }),
    'GET /api/projects/p1': () => json(200, project),
    'GET /api/projects/p1/members': () => json(200, []),
  });
  render(
    <AppProviders>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/proyectos/p1'] })} />
    </AppProviders>,
  );
}

describe('sección de diagramas del proyecto', () => {
  it('con el flag activado, el proyecto enlaza a sus diagramas', async () => {
    renderProject({ accounts: true, diagrams: true });
    const link = await screen.findByRole('link', { name: 'Diagramas' });
    expect(link).toHaveAttribute('href', '/proyectos/p1/diagramas');
  });

  it('con el flag desactivado, no aparece', async () => {
    renderProject({ accounts: true, diagrams: false });
    expect(await screen.findByRole('heading', { name: 'Tienda en línea' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Diagramas' })).not.toBeInTheDocument();
  });
});
