import type { Activity } from '@reqcanvas/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { useWorkspaceStore } from '../src/features/diagrams/workspace/store';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi, type Handler } from './helpers/api';
import { mockUploads } from './helpers/xhr';

const project = (myRole: string, status = 'open') => ({
  id: 'p1',
  name: 'Tienda en línea',
  description: '',
  status,
  myRole,
  lastActivityAt: '2026-09-30T10:00:00.000Z',
  memberCount: 2,
  createdAt: '2026-09-30T09:00:00.000Z',
});
const summary = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  name: 'Proceso de compra',
  order: 0,
  publishedVersionId: 'v1',
  draftVersionId: 'v2',
  ...overrides,
});
const activity: Activity = {
  id: 'a1',
  key: '11111111-1111-4111-8111-111111111111',
  rev: 0,
  source: 'manual',
  label: 'Validar pago',
  type: 'decision',
  bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
  next: [],
};
const version = (id: string, number: number, status: string, activities: Activity[] = []) => ({
  id,
  diagramId: 'd1',
  number,
  status,
  image: {
    displayUrl: `/api/diagram-versions/${id}/image/display`,
    thumbUrl: `/api/diagram-versions/${id}/image/thumb`,
    width: 900,
    height: 1200,
  },
  publishedAt: status === 'published' ? '2026-09-30T11:00:00.000Z' : null,
  activities,
});

beforeEach(() => {
  useAuthStore.getState().setSession({
    accessToken: 'token-1',
    expiresIn: 900,
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  });
  useWorkspaceStore.getState().reset();
  // Pantalla de escritorio: el Administrador puede editar (≥ 768 px).
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

function renderWorkspace(handlers: Record<string, Handler | Handler[]>) {
  const api = mockApi({
    'GET /api/config': () => json(200, { flags: { accounts: true, diagrams: true } }),
    'GET /api/diagram-versions/v1': () => json(200, version('v1', 1, 'published', [activity])),
    ...handlers,
  });
  render(
    <AppProviders>
      <RouterProvider
        router={createMemoryRouter(routes, { initialEntries: ['/proyectos/p1/diagramas/d1'] })}
      />
    </AppProviders>,
  );
  return api;
}

const header = () => screen.getByRole('main').querySelector('header')!;

describe('publicar (US3)', () => {
  it('sin actividades, "Publicar" está deshabilitado y explica por qué', async () => {
    renderWorkspace({
      'GET /api/projects/p1': () => json(200, project('admin')),
      'GET /api/projects/p1/diagrams': () => json(200, [summary()]),
      'GET /api/diagram-versions/v2': () => json(200, version('v2', 2, 'draft')),
    });
    const button = await screen.findByRole('button', { name: 'Publicar' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Marca al menos una actividad para publicar.');
  });

  it('publica el borrador y muestra la versión como publicada', async () => {
    const api = renderWorkspace({
      'GET /api/projects/p1': () => json(200, project('admin')),
      'GET /api/projects/p1/diagrams': [
        () => json(200, [summary()]),
        () => json(200, [summary({ publishedVersionId: 'v2', draftVersionId: null })]),
      ],
      'GET /api/diagram-versions/v2': [
        () => json(200, version('v2', 2, 'draft', [activity])),
        () => json(200, version('v2', 2, 'published', [activity])),
      ],
      'POST /api/diagram-versions/v2/publish': () => json(200, version('v2', 2, 'published')),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Publicar' }));
    await waitFor(() =>
      expect(within(header()).getByText('Versión 2 · Publicado')).toBeInTheDocument(),
    );
    expect(api.requests.some((r) => r.method === 'POST' && r.url.endsWith('/publish'))).toBe(true);
    // Publicada, ya no se edita: el panel del editor desaparece.
    expect(screen.queryByRole('complementary', { name: 'Editor de actividades' })).toBeNull();
    expect(useWorkspaceStore.getState().mode).toBe('view');
  });

  it('muestra el error de la API al publicar', async () => {
    renderWorkspace({
      'GET /api/projects/p1': () => json(200, project('admin')),
      'GET /api/projects/p1/diagrams': () => json(200, [summary()]),
      'GET /api/diagram-versions/v2': () => json(200, version('v2', 2, 'draft', [activity])),
      'POST /api/diagram-versions/v2/publish': () =>
        json(409, { code: 'VERSION_NOT_DRAFT', message: 'Esta versión ya no está en borrador.' }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Publicar' }));
    expect(await screen.findByText('Esta versión ya no está en borrador.')).toBeInTheDocument();
  });

  it('sin borrador, el Administrador puede subir una versión nueva', async () => {
    const { sent } = mockUploads([{ status: 201, body: version('v3', 2, 'draft') }]);
    renderWorkspace({
      'GET /api/projects/p1': () => json(200, project('admin')),
      'GET /api/projects/p1/diagrams': [
        () => json(200, [summary({ draftVersionId: null })]),
        () => json(200, [summary({ draftVersionId: 'v3' })]),
      ],
      'GET /api/diagram-versions/v3': () => json(200, version('v3', 2, 'draft', [activity])),
    });
    expect(await screen.findByText('Versión 1 · Publicado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Subir versión nueva' }));
    const dialog = screen.getByRole('dialog', { name: 'Subir versión nueva' });
    await userEvent.upload(
      within(dialog).getByLabelText('Imagen (PNG, JPG o SVG, máx. 10 MB)'),
      new File([new Uint8Array(10)], 'v2.png', { type: 'image/png' }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Subir' }));

    await waitFor(() =>
      expect(within(header()).getByText('Versión 2 · Borrador')).toBeInTheDocument(),
    );
    expect(sent[0]).toMatchObject({ url: '/api/diagrams/d1/versions' });
  });
});

describe('Participante (US3 escenario 2)', () => {
  it('ve la versión publicada sin herramientas de edición', async () => {
    renderWorkspace({
      'GET /api/projects/p1': () => json(200, project('participant')),
      'GET /api/projects/p1/diagrams': () =>
        json(200, [{ id: 'd1', name: 'Proceso de compra', order: 0, publishedVersionId: 'v1' }]),
    });
    expect(await screen.findByText('Versión 1 · Publicado')).toBeInTheDocument();
    expect(useWorkspaceStore.getState().mode).toBe('view');
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Subir versión nueva' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Editor de actividades' })).toBeNull();
  });

  it('en un proyecto cerrado, el Administrador tampoco edita ni publica', async () => {
    renderWorkspace({
      'GET /api/projects/p1': () => json(200, project('admin', 'closed')),
      'GET /api/projects/p1/diagrams': () => json(200, [summary()]),
      'GET /api/diagram-versions/v2': () => json(200, version('v2', 2, 'draft', [activity])),
    });
    expect(await screen.findByText('Versión 2 · Borrador')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Editor de actividades' })).toBeNull();
  });
});
