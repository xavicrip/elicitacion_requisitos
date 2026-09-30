import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlagGate } from '../src/lib/flags';

// Con `accounts` desactivado, web no muestra registro ni login (constitución IV, análisis C1).

function renderGate(flags: Record<string, boolean> | 'error') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      flags === 'error'
        ? new Response('Bad Gateway', { status: 502 })
        : new Response(JSON.stringify({ flags }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
    ),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FlagGate flag="accounts" fallback={<p>No disponible</p>}>
        <p>Iniciar sesión</p>
      </FlagGate>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('FlagGate con los flags de /api/config', () => {
  it('muestra el contenido si el flag está activado', async () => {
    renderGate({ accounts: true });
    expect(await screen.findByText('Iniciar sesión')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/config', expect.anything());
  });

  it('muestra la alternativa si el flag está desactivado', async () => {
    renderGate({ accounts: false });
    expect(await screen.findByText('No disponible')).toBeInTheDocument();
    expect(screen.queryByText('Iniciar sesión')).not.toBeInTheDocument();
  });

  it('si no puede leer los flags, trata el flag como desactivado', async () => {
    renderGate('error');
    expect(await screen.findByText('No disponible')).toBeInTheDocument();
  });

  it('mientras carga no muestra ni el contenido ni la alternativa', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FlagGate flag="accounts" fallback={<p>No disponible</p>}>
          <p>Iniciar sesión</p>
        </FlagGate>
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Iniciar sesión')).not.toBeInTheDocument();
    expect(screen.queryByText('No disponible')).not.toBeInTheDocument();
  });
});
