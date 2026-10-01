import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi } from './helpers/api';
import { mockUploads } from './helpers/xhr';

const FLAGS = { flags: { accounts: true } };
const project = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Tienda en línea',
  description: '',
  status: 'open',
  myRole: 'admin',
  lastActivityAt: '2026-09-30T10:00:00.000Z',
  memberCount: 2,
  createdAt: '2026-09-30T09:00:00.000Z',
  ...overrides,
});
const version = {
  id: 'v1',
  diagramId: 'd1',
  number: 1,
  status: 'draft',
  image: {
    displayUrl: '/api/diagram-versions/v1/image/display',
    thumbUrl: '/api/diagram-versions/v1/image/thumb',
    width: 900,
    height: 1200,
  },
  publishedAt: null,
};

beforeEach(() => {
  useAuthStore.getState().setSession({
    accessToken: 'token-1',
    expiresIn: 900,
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  });
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:miniatura', revokeObjectURL: () => {} }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

function renderAt(path: string, handlers: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({
    'GET /api/config': () => json(200, FLAGS),
    'GET /api/projects/p1': () => json(200, project()),
    'GET /api/projects/p1/diagrams': () => json(200, []),
    'GET /api/diagram-versions/v1/image/thumb': () =>
      new Response(new Blob(['webp']), { status: 200 }),
    ...handlers,
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { router, api };
}

const png = (bytes = 1024, name = 'compra.png', type = 'image/png') =>
  new File([new Uint8Array(bytes)], name, { type });

async function openUpload() {
  await userEvent.click(await screen.findByRole('button', { name: 'Nuevo diagrama' }));
  return screen.getByRole('dialog', { name: 'Nuevo diagrama' });
}

describe('lista de diagramas (US1)', () => {
  it('muestra los diagramas con su miniatura y su estado', async () => {
    renderAt('/proyectos/p1/diagramas', {
      'GET /api/projects/p1/diagrams': () =>
        json(200, [
          {
            id: 'd1',
            name: 'Proceso de compra',
            order: 0,
            publishedVersionId: null,
            draftVersionId: 'v1',
            thumbUrl: '/api/diagram-versions/v1/image/thumb',
          },
        ]),
    });
    const link = await screen.findByRole('link', { name: /Proceso de compra/ });
    expect(link).toHaveAttribute('href', '/proyectos/p1/diagramas/d1');
    expect(within(link).getByText('Borrador')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(link).getByRole('img', { name: 'Proceso de compra' })).toHaveAttribute(
        'src',
        'blob:miniatura',
      ),
    );
  });

  it('sin diagramas, lo indica', async () => {
    renderAt('/proyectos/p1/diagramas');
    expect(await screen.findByText('Todavía no hay diagramas.')).toBeInTheDocument();
  });

  it('un Participante no ve el botón de subida', async () => {
    renderAt('/proyectos/p1/diagramas', {
      'GET /api/projects/p1': () => json(200, project({ myRole: 'participant' })),
    });
    expect(await screen.findByRole('heading', { name: 'Diagramas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo diagrama' })).not.toBeInTheDocument();
  });

  it('en un proyecto cerrado no se puede subir', async () => {
    renderAt('/proyectos/p1/diagramas', {
      'GET /api/projects/p1': () => json(200, project({ status: 'closed' })),
    });
    expect(await screen.findByRole('heading', { name: 'Diagramas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo diagrama' })).not.toBeInTheDocument();
  });
});

describe('diálogo de subida (US1)', () => {
  it('sube con progreso y abre el espacio de trabajo del diagrama', async () => {
    const { sent, gate } = mockUploads([{ status: 201, body: version }]);
    gate.hold = true;
    const { router } = renderAt('/proyectos/p1/diagramas');
    const dialog = await openUpload();
    await userEvent.type(within(dialog).getByLabelText('Nombre'), 'Proceso de compra');
    await userEvent.upload(
      within(dialog).getByLabelText('Imagen (PNG, JPG o SVG, máx. 10 MB)'),
      png(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Subir' }));

    const progress = await within(dialog).findByRole('progressbar', {
      name: 'Progreso de la subida',
    });
    await waitFor(() => expect(progress).toHaveAttribute('value', '50'));
    gate.release();

    await waitFor(() => expect(router.state.location.pathname).toBe('/proyectos/p1/diagramas/d1'));
    expect(sent[0]).toMatchObject({
      method: 'POST',
      url: '/api/projects/p1/diagrams',
      headers: { authorization: 'Bearer token-1' },
    });
    expect(sent[0]!.body.get('name')).toBe('Proceso de compra');
    expect((sent[0]!.body.get('file') as File).name).toBe('compra.png');
  });

  it.each([
    ['un archivo de más de 10 MB', png(10 * 1024 * 1024 + 1), 'Máximo 10 MB'],
    ['un PDF', png(100, 'doc.pdf', 'application/pdf'), 'Formato no admitido'],
  ])('rechaza en el navegador %s sin subirlo', async (_caso, file, message) => {
    const { sent } = mockUploads([]);
    renderAt('/proyectos/p1/diagramas');
    const dialog = await openUpload();
    await userEvent.type(within(dialog).getByLabelText('Nombre'), 'Proceso');
    // En el navegador se puede elegir "Todos los archivos" aunque el input tenga `accept`.
    await userEvent
      .setup({ applyAccept: false })
      .upload(within(dialog).getByLabelText('Imagen (PNG, JPG o SVG, máx. 10 MB)'), file);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Subir' }));
    expect(await within(dialog).findByText(new RegExp(message))).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it('muestra el error de la API (p. ej., contenido que no es una imagen)', async () => {
    mockUploads([
      {
        status: 415,
        body: {
          code: 'UNSUPPORTED_FORMAT',
          message: 'Formato no admitido. Sube una imagen PNG, JPG o SVG.',
        },
      },
    ]);
    renderAt('/proyectos/p1/diagramas');
    const dialog = await openUpload();
    await userEvent.type(within(dialog).getByLabelText('Nombre'), 'Falso');
    await userEvent.upload(
      within(dialog).getByLabelText('Imagen (PNG, JPG o SVG, máx. 10 MB)'),
      png(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Subir' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Formato no admitido');
  });

  it('exige el nombre', async () => {
    const { sent } = mockUploads([]);
    renderAt('/proyectos/p1/diagramas');
    const dialog = await openUpload();
    await userEvent.upload(
      within(dialog).getByLabelText('Imagen (PNG, JPG o SVG, máx. 10 MB)'),
      png(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Subir' }));
    expect(await within(dialog).findByText('Escribe el nombre del diagrama.')).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });
});
