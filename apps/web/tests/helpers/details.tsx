import type { Activity, Detail } from '@reqcanvas/shared';
import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, vi } from 'vitest';
import { AppProviders, routes } from '../../src/app/router';
import { useWorkspaceStore } from '../../src/features/diagrams/workspace/store';
import { useAuthStore } from '../../src/lib/auth-store';
import { json, mockApi, type Handler } from './api';

/** Datos y montaje comunes de las pruebas del panel de requisitos (004). */

export const KEY = '11111111-1111-4111-8111-111111111111';

export const activity: Activity = {
  id: 'a1',
  key: KEY,
  rev: 0,
  source: 'manual',
  label: 'Validar pago',
  type: 'decision',
  bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
  next: [],
};

export const project = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Tienda en línea',
  description: '',
  status: 'open',
  myRole: 'participant',
  lastActivityAt: '2026-10-01T10:00:00.000Z',
  memberCount: 3,
  createdAt: '2026-10-01T09:00:00.000Z',
  ...overrides,
});

export const version = (id: string, number: number, status: string) => ({
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
  activities: [activity],
});

export const detail = (overrides: Partial<Detail> = {}): Detail => ({
  id: 'x1',
  diagramId: 'd1',
  activityKey: KEY,
  given: 'el cliente tiene productos en el carrito',
  when: 'paga con tarjeta',
  then: 'el sistema confirma el pago',
  type: 'non_functional',
  priority: 'must',
  authorRole: 'Cajero',
  tags: ['pagos'],
  status: 'pending',
  duplicateOf: null,
  discardReason: null,
  voteCount: 2,
  votedByMe: false,
  commentCount: 0,
  author: { id: 'u2', name: 'Luis' },
  rev: 0,
  createdAt: '2026-10-01T10:30:00.000Z',
  updatedAt: '2026-10-01T10:30:00.000Z',
  permissions: { canEdit: false, canDelete: false, canVote: true, canModerate: false },
  ...overrides,
});

export const DETAILS_URL = `GET /api/diagrams/d1/activities/${KEY}/details?sort=votes`;

/** Sesión de Marta y estado del espacio de trabajo limpios en cada prueba. */
export function useDetailsTestSession() {
  beforeEach(() => {
    useAuthStore.getState().setSession({
      accessToken: 'token-1',
      expiresIn: 900,
      user: { id: 'u1', name: 'Marta', email: 'marta@example.com' },
    });
    useWorkspaceStore.getState().reset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.getState().clear();
  });
}

/** Monta el espacio de trabajo de un diagrama publicado con la API simulada. */
export function renderWorkspace(
  handlers: Record<string, Handler | Handler[]> = {},
  flags: Record<string, boolean> = { accounts: true },
) {
  const api = mockApi({
    'GET /api/config': () => json(200, { flags }),
    'GET /api/projects/p1': () => json(200, project()),
    'GET /api/projects/p1/diagrams': () =>
      json(200, [{ id: 'd1', name: 'Proceso de compra', order: 0, publishedVersionId: 'v1' }]),
    'GET /api/diagram-versions/v1': () => json(200, version('v1', 1, 'published')),
    [DETAILS_URL]: () => json(200, [detail()]),
    'GET /api/projects/p1/details/facets': () =>
      json(200, {
        roles: [{ value: 'Cajero', count: 2 }],
        tags: [
          { value: 'pagos', count: 3 },
          { value: 'legal', count: 1 },
        ],
      }),
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

/** Selecciona "Validar pago" (en jsdom no hay canvas: se usa el store) y devuelve el panel. */
export async function selectActivity() {
  await screen.findByText('Versión 1 · Publicado');
  act(() => useWorkspaceStore.getState().select(KEY));
  return screen.findByRole('complementary', { name: 'Requisitos' });
}
