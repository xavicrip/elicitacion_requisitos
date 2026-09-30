import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppProviders, routes } from '../src/app/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('router de la app (research R10)', () => {
  it('la raíz muestra la página inicial dentro del layout', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'ReqCanvas', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('ReqCanvas');
    expect(screen.getByRole('contentinfo')).toHaveTextContent(/^v\S+$/);
  });

  it('una ruta desconocida muestra "Página no encontrada" con un enlace al inicio', async () => {
    renderAt('/no-existe');
    expect(
      await screen.findByRole('heading', { name: 'Página no encontrada' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
  });
});
