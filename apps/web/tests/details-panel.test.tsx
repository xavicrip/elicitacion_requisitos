import type { Activity, Detail } from '@reqcanvas/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { useWorkspaceStore } from '../src/features/diagrams/workspace/store';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi, type Handler } from './helpers/api';

const KEY = '11111111-1111-4111-8111-111111111111';
const activity: Activity = {
  id: 'a1',
  key: KEY,
  rev: 0,
  source: 'manual',
  label: 'Validar pago',
  type: 'decision',
  bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
  next: [],
};
const project = (overrides: Record<string, unknown> = {}) => ({
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
  activities: [activity],
});
const detail = (overrides: Partial<Detail> = {}): Detail => ({
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
const DETAILS_URL = `GET /api/diagrams/d1/activities/${KEY}/details?sort=votes`;

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

function renderWorkspace(
  handlers: Record<string, Handler | Handler[]> = {},
  flags: Record<string, boolean> = { accounts: true, diagrams: true, details: true },
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

async function selectActivity() {
  await screen.findByText('Versión 1 · Publicado');
  act(() => useWorkspaceStore.getState().select(KEY));
  return screen.findByRole('complementary', { name: 'Requisitos' });
}

describe('panel de detalles (US1, FR-001)', () => {
  it('sin actividad seleccionada, invita a seleccionar una', async () => {
    renderWorkspace();
    const panel = await screen.findByRole('complementary', { name: 'Requisitos' });
    expect(panel).toHaveTextContent('Selecciona una actividad');
  });

  it('al seleccionar una actividad muestra sus detalles con autor y fecha', async () => {
    renderWorkspace();
    const panel = await selectActivity();
    expect(
      within(panel).getByRole('heading', { name: 'Requisitos de «Validar pago»' }),
    ).toBeInTheDocument();
    const card = await within(panel).findByRole('article');
    expect(card).toHaveTextContent('Dado el cliente tiene productos en el carrito');
    expect(card).toHaveTextContent('Cuando paga con tarjeta');
    expect(card).toHaveTextContent('Entonces el sistema confirma el pago');
    expect(card).toHaveTextContent('No funcional');
    expect(card).toHaveTextContent('Luis');
    expect(card).toHaveTextContent('1/10/2026');
    expect(card).toHaveTextContent('#pagos');
  });

  it('el texto con HTML se muestra literal', async () => {
    renderWorkspace({
      [DETAILS_URL]: () => json(200, [detail({ given: '<b>negrita</b> texto' })]),
    });
    const panel = await selectActivity();
    expect(await within(panel).findByText(/<b>negrita<\/b> texto/)).toBeInTheDocument();
    expect(panel.querySelector('b')).toBeNull();
  });

  it('registra un detalle y vuelve a cargar la lista', async () => {
    const api = renderWorkspace({
      [DETAILS_URL]: [() => json(200, []), () => json(200, [detail()])],
      [`POST /api/diagrams/d1/activities/${KEY}/details`]: () => json(201, detail()),
    });
    const panel = await selectActivity();
    await userEvent.type(
      within(panel).getByLabelText('Dado (contexto)'),
      'el cliente tiene productos en el carrito',
    );
    await userEvent.type(within(panel).getByLabelText('Cuando (acción)'), 'paga con tarjeta');
    await userEvent.type(
      within(panel).getByLabelText('Entonces (resultado)'),
      'el sistema confirma el pago',
    );
    await userEvent.selectOptions(within(panel).getByLabelText('Tipo'), 'No funcional');
    await userEvent.selectOptions(
      within(panel).getByLabelText('Prioridad'),
      'Must (imprescindible)',
    );
    await userEvent.type(within(panel).getByLabelText('Tu rol'), 'Cajero');
    await userEvent.type(
      within(panel).getByLabelText('Etiquetas (separadas por comas)'),
      'Pagos, tarjeta',
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Guardar requisito' }));

    await waitFor(() => expect(within(panel).getByRole('article')).toBeInTheDocument());
    const post = api.requests.find((request) => request.method === 'POST');
    expect(post?.body).toEqual({
      given: 'el cliente tiene productos en el carrito',
      when: 'paga con tarjeta',
      then: 'el sistema confirma el pago',
      type: 'non_functional',
      priority: 'must',
      authorRole: 'Cajero',
      tags: ['Pagos', 'tarjeta'],
    });
    expect(within(panel).getByLabelText('Dado (contexto)')).toHaveValue('');
  });

  it('indica qué campo falta y no envía nada (US1 escenario 2)', async () => {
    const api = renderWorkspace();
    const panel = await selectActivity();
    await userEvent.type(within(panel).getByLabelText('Dado (contexto)'), 'el cliente compra');
    await userEvent.click(within(panel).getByRole('button', { name: 'Guardar requisito' }));
    expect(
      await within(panel).findByText('Escribe la acción (Cuando): al menos 5 caracteres.'),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText('Escribe el resultado (Entonces): al menos 5 caracteres.'),
    ).toBeInTheDocument();
    expect(api.requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('el contador de caracteres avisa cerca del límite de 1 000', async () => {
    renderWorkspace();
    const panel = await selectActivity();
    const field = within(panel).getByLabelText('Entonces (resultado)');
    await userEvent.click(field);
    await userEvent.paste('x'.repeat(950));
    expect(within(panel).getByText('950/1000')).toBeInTheDocument();
  });

  it('sugiere roles y etiquetas ya usados en el proyecto (FR-003)', async () => {
    renderWorkspace();
    const panel = await selectActivity();
    await waitFor(() =>
      expect(panel.querySelector('datalist option[value="Cajero"]')).not.toBeNull(),
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Añadir la etiqueta legal' }));
    expect(within(panel).getByLabelText('Etiquetas (separadas por comas)')).toHaveValue('legal');
  });

  it('en un proyecto cerrado se ven los detalles pero no el formulario (US1 escenario 4)', async () => {
    renderWorkspace({ 'GET /api/projects/p1': () => json(200, project({ status: 'closed' })) });
    const panel = await selectActivity();
    expect(await within(panel).findByRole('article')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Guardar requisito' })).toBeNull();
    expect(panel).toHaveTextContent('El proyecto está cerrado');
  });

  it('con el flag details desactivado no hay panel de requisitos', async () => {
    renderWorkspace({}, { accounts: true, diagrams: true, details: false });
    await screen.findByText('Versión 1 · Publicado');
    expect(screen.queryByRole('complementary', { name: 'Requisitos' })).toBeNull();
  });
});

describe('Administrador con borrador y versión publicada (plan, ajuste 8)', () => {
  it('cambia entre Borrador y Publicada para ver los requisitos', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderWorkspace({
      'GET /api/projects/p1': () => json(200, project({ myRole: 'admin' })),
      'GET /api/projects/p1/diagrams': () =>
        json(200, [
          {
            id: 'd1',
            name: 'Proceso de compra',
            order: 0,
            publishedVersionId: 'v1',
            draftVersionId: 'v2',
          },
        ]),
      'GET /api/diagram-versions/v2': () => json(200, version('v2', 2, 'draft')),
    });
    expect(await screen.findByText('Versión 2 · Borrador')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Requisitos' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Ver la versión publicada' }));
    expect(await screen.findByText('Versión 1 · Publicado')).toBeInTheDocument();
    expect(await screen.findByRole('complementary', { name: 'Requisitos' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Editar el borrador' }));
    expect(await screen.findByText('Versión 2 · Borrador')).toBeInTheDocument();
  });
});
