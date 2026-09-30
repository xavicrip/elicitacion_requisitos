import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppProviders, routes } from '../src/app/router';

afterEach(() => {
  delete window.__REQCANVAS_CONFIG__;
});

function renderHome() {
  render(
    <AppProviders>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />
    </AppProviders>,
  );
}

describe('página inicial', () => {
  it('muestra el nombre del producto', async () => {
    renderHome();
    expect(await screen.findByRole('heading', { name: 'ReqCanvas' })).toBeInTheDocument();
  });

  it('muestra la versión inyectada en /config.js', async () => {
    window.__REQCANVAS_CONFIG__ = { apiUrl: '', version: '0.1.0' };
    renderHome();
    expect(await screen.findByText(/v0\.1\.0/)).toBeInTheDocument();
  });

  it('muestra "dev" si no hay configuración inyectada', async () => {
    renderHome();
    expect(await screen.findByText(/vdev/)).toBeInTheDocument();
  });

  it('avisa si el navegador no soporta WebGL (jsdom no lo soporta)', async () => {
    renderHome();
    expect(await screen.findByRole('status')).toHaveTextContent(/WebGL/);
  });
});
