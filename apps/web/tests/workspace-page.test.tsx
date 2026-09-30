import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { useWorkspaceStore } from '../src/features/diagrams/workspace/store';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi } from './helpers/api';

const project = (myRole = 'admin') => ({
  id: 'p1',
  name: 'Tienda en línea',
  description: '',
  status: 'open',
  myRole,
  lastActivityAt: '2026-09-30T10:00:00.000Z',
  memberCount: 2,
  createdAt: '2026-09-30T09:00:00.000Z',
});
const summary = {
  id: 'd1',
  name: 'Proceso de compra',
  order: 0,
  publishedVersionId: 'v1',
  draftVersionId: 'v2',
  thumbUrl: '/api/diagram-versions/v2/image/thumb',
};
const version = (id: string, number: number, status: string) => ({
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
  publishedAt: null,
  activities: [],
});

beforeEach(() => {
  useAuthStore.getState().setSession({
    accessToken: 'token-1',
    expiresIn: 900,
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  });
  useWorkspaceStore.getState().reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

function renderWorkspace(role: string, diagrams = [summary]) {
  mockApi({
    'GET /api/config': () => json(200, { flags: { accounts: true, diagrams: true } }),
    'GET /api/projects/p1': () => json(200, project(role)),
    'GET /api/projects/p1/diagrams': () =>
      json(200, role === 'admin' ? diagrams : diagrams.map(({ draftVersionId: _, ...d }) => d)),
    'GET /api/diagram-versions/v1': () => json(200, version('v1', 1, 'published')),
    'GET /api/diagram-versions/v2': () => json(200, version('v2', 2, 'draft')),
  });
  render(
    <AppProviders>
      <RouterProvider
        router={createMemoryRouter(routes, { initialEntries: ['/proyectos/p1/diagramas/d1'] })}
      />
    </AppProviders>,
  );
}

describe('espacio de trabajo (US1)', () => {
  it('el Administrador abre el borrador en modo vista', async () => {
    renderWorkspace('admin');
    expect(await screen.findByRole('heading', { name: 'Proceso de compra' })).toBeInTheDocument();
    expect(await screen.findByText('Versión 2 · Borrador')).toBeInTheDocument();
    expect(useWorkspaceStore.getState()).toMatchObject({ versionId: 'v2', mode: 'view' });
  });

  it('un Participante abre la versión publicada', async () => {
    renderWorkspace('participant');
    expect(await screen.findByText('Versión 1 · Publicado')).toBeInTheDocument();
    expect(useWorkspaceStore.getState().versionId).toBe('v1');
  });

  it('sin WebGL 2 muestra un aviso en lugar del canvas', async () => {
    renderWorkspace('admin');
    expect(await screen.findByText(/WebGL 2/)).toBeInTheDocument();
  });

  it('un diagrama que no existe o no es visible muestra "Diagrama no encontrado"', async () => {
    renderWorkspace('admin', []);
    expect(await screen.findByText('Diagrama no encontrado')).toBeInTheDocument();
  });
});
