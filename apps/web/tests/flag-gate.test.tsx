import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlagGate } from '../src/lib/flags';

// Constitución IV: con un flag desactivado, web no muestra lo que oculta. `ejemplo` no es un flag
// real: FlagGate acepta cualquier nombre.

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
      <FlagGate flag="ejemplo" fallback={<p>No disponible</p>}>
        <p>Contenido</p>
      </FlagGate>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('FlagGate con los flags de /api/config', () => {
  it('muestra el contenido si el flag está activado', async () => {
    renderGate({ ejemplo: true });
    expect(await screen.findByText('Contenido')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/config', expect.anything());
  });

  it('muestra la alternativa si el flag está desactivado', async () => {
    renderGate({ ejemplo: false });
    expect(await screen.findByText('No disponible')).toBeInTheDocument();
    expect(screen.queryByText('Contenido')).not.toBeInTheDocument();
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
        <FlagGate flag="ejemplo" fallback={<p>No disponible</p>}>
          <p>Contenido</p>
        </FlagGate>
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Contenido')).not.toBeInTheDocument();
    expect(screen.queryByText('No disponible')).not.toBeInTheDocument();
  });
});
