import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';

afterEach(() => {
  delete window.__REQCANVAS_CONFIG__;
});

describe('App', () => {
  it('muestra el nombre del producto', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'ReqCanvas' })).toBeInTheDocument();
  });

  it('muestra la versión inyectada en /config.js', () => {
    window.__REQCANVAS_CONFIG__ = { apiUrl: 'https://api.example.com', version: '0.1.0' };
    render(<App />);
    expect(screen.getByText(/v0\.1\.0/)).toBeInTheDocument();
  });

  it('muestra "dev" si no hay configuración inyectada', () => {
    render(<App />);
    expect(screen.getByText(/vdev/)).toBeInTheDocument();
  });

  it('avisa si el navegador no soporta WebGL (jsdom no lo soporta)', () => {
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent(/WebGL/);
  });
});
