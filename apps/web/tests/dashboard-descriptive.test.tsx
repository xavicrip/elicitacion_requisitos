import type { DescriptiveDashboard } from '@reqcanvas/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { barOption } from '../src/features/dashboard/descriptive/Distributions';
import { timelineOption } from '../src/features/dashboard/descriptive/Timeline';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi, type Handler } from './helpers/api';

// US1 de la 007 (FR-001, FR-002, FR-003): el dashboard descriptivo. El lienzo de ECharts se
// sustituye por un doble: la información se comprueba en las fichas y en las tablas alternativas.

vi.mock('../src/features/dashboard/charts/EChart', () => ({
  default: () => <div data-testid="echart" />,
}));

const URL = '/api/projects/p1/dashboard/descriptive';
const XSS = '<img src=x onerror=alert(1)>';

const project = (myRole: string) => ({
  id: 'p1',
  name: 'Tienda demo',
  description: '',
  status: 'open',
  myRole,
  lastActivityAt: '2026-09-30T10:00:00.000Z',
  memberCount: 6,
  createdAt: '2026-09-30T09:00:00.000Z',
});

const descriptive = (overrides: Partial<DescriptiveDashboard> = {}): DescriptiveDashboard => ({
  kpis: { totalDetails: 80, activeParticipants: 6, coveredActivitiesPct: 90, validatedPct: 15.5 },
  byActivity: [
    { key: 'k1', label: 'Validar pago', count: 24 },
    { key: 'k2', label: XSS, count: 3 },
  ],
  byType: [
    { key: 'functional', label: 'Funcional', count: 38 },
    { key: 'non_functional', label: 'No funcional', count: 28 },
  ],
  byPriority: [{ key: 'must', label: 'Must', count: 18 }],
  byRole: [{ key: 'Cajero', label: 'Cajero', count: 16 }],
  byStatus: [
    { key: 'pending', label: 'Pendiente', count: 68 },
    { key: 'validated', label: 'Validado', count: 12 },
  ],
  timeline: [
    { date: '2026-09-10', created: 50, votes: 20, comments: 5 },
    { date: '2026-09-11', created: 30, votes: 12, comments: 9 },
  ],
  ...overrides,
});

const version = {
  id: 'v1',
  diagramId: 'd1',
  number: 1,
  status: 'published',
  image: { displayUrl: '/api/x', thumbUrl: '/api/y', width: 900, height: 600 },
  publishedAt: '2026-09-30T09:00:00.000Z',
  activities: [
    {
      id: 'a1',
      key: 'k1',
      label: 'Validar pago',
      type: 'action',
      bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      next: [],
      source: 'manual',
      rev: 0,
    },
    {
      id: 'a2',
      key: 'k2',
      label: XSS,
      type: 'action',
      bbox: { x: 0.5, y: 0.2, w: 0.3, h: 0.1 },
      next: [],
      source: 'manual',
      rev: 0,
    },
  ],
};

beforeEach(() => {
  useAuthStore.getState().setSession({
    accessToken: 'token-1',
    expiresIn: 900,
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

function renderAt(
  path: string,
  { role = 'admin', flag = true, handlers = {} as Record<string, Handler | Handler[]> } = {},
) {
  const api = mockApi({
    'GET /api/config': () => json(200, { flags: flag ? { dashboard: true } : {} }),
    'GET /api/projects/p1': () => json(200, project(role)),
    'GET /api/projects/p1/members': () => json(200, []),
    'GET /api/projects/p1/diagrams': () =>
      json(200, [
        {
          id: 'd1',
          name: 'Proceso de compra',
          order: 0,
          publishedVersionId: 'v1',
          draftVersionId: null,
          thumbUrl: '/api/y',
        },
      ]),
    'GET /api/diagram-versions/v1': () => json(200, version),
    [`GET ${URL}`]: () => json(200, descriptive()),
    ...handlers,
  });
  render(
    <AppProviders>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AppProviders>,
  );
  return api;
}

const dashboard = (options?: Parameters<typeof renderAt>[1]) =>
  renderAt('/proyectos/p1/dashboard', options);

describe('indicadores y gráficos', () => {
  it('muestra los indicadores clave', async () => {
    dashboard();
    const kpis = await screen.findByLabelText('Indicadores clave');
    const value = (label: string) =>
      within(kpis).getByText(label).parentElement!.querySelector('dd')!.textContent;
    expect(value('Detalles')).toBe('80');
    expect(value('Participantes activos')).toBe('6');
    expect(value('Actividades cubiertas')).toBe('90 %');
    expect(value('Detalles validados')).toBe('15,5 %');
  });

  it('cada gráfico tiene su título, una descripción y una tabla con los mismos datos', async () => {
    dashboard();
    const figure = await screen.findByRole('figure', { name: 'Detalles por tipo' });
    expect(within(figure).getByText('El mayor: Funcional, con 38.')).toBeInTheDocument();
    const rows = within(within(figure).getByRole('table', { hidden: true })).getAllByRole('row', {
      hidden: true,
    });
    expect(rows.map((row) => row.textContent)).toEqual([
      'TipoDetalles',
      'Funcional38',
      'No funcional28',
    ]);
    for (const title of [
      'Detalles por actividad',
      'Detalles por prioridad',
      'Detalles por rol de quien aporta',
      'Detalles por estado',
      'Aportes en el tiempo',
    ]) {
      expect(screen.getByRole('figure', { name: title })).toBeInTheDocument();
    }
    const timeline = screen.getByRole('figure', { name: 'Aportes en el tiempo' });
    expect(within(timeline).getByText(/80 detalles creados entre el/)).toBeInTheDocument();
  });

  it('el texto de los usuarios se muestra como texto, también en los tooltips', async () => {
    dashboard();
    const figure = await screen.findByRole('figure', { name: 'Detalles por actividad' });
    expect(within(figure).getByText(XSS, { selector: 'th' })).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();

    const option = barOption(descriptive().byActivity) as {
      tooltip: { formatter: (params: { name: string; value: number }) => string };
    };
    expect(option.tooltip.formatter({ name: XSS, value: 3 })).toBe(
      '&lt;img src=x onerror=alert(1)&gt;: <b>3</b>',
    );
    const lines = timelineOption(descriptive().timeline) as {
      tooltip: {
        formatter: (
          params: Array<{ axisValueLabel: string; seriesName: string; value: number }>,
        ) => string;
      };
    };
    expect(
      lines.tooltip.formatter([{ axisValueLabel: XSS, seriesName: 'Votos', value: 1 }]),
    ).not.toContain('<img');
  });
});

describe('filtros (FR-003)', () => {
  it('cada filtro recalcula con su query', async () => {
    const empty = () =>
      json(200, descriptive({ kpis: { ...descriptive().kpis, totalDetails: 28 } }));
    const api = dashboard({
      handlers: {
        [`GET ${URL}?type=non_functional`]: empty,
        [`GET ${URL}?type=non_functional&from=2026-09-10`]: empty,
        [`GET ${URL}?type=non_functional&from=2026-09-10&status=pending&status=validated&status=discarded`]:
          empty,
        [`GET ${URL}?diagramId=d1&type=non_functional&from=2026-09-10&status=pending&status=validated&status=discarded`]:
          empty,
      },
    });
    const filters = await screen.findByRole('form', { name: 'Filtros' });
    await userEvent.selectOptions(within(filters).getByLabelText('Tipo'), 'non_functional');
    await waitFor(() =>
      expect(api.requests.map((r) => r.url)).toContain(`${URL}?type=non_functional`),
    );
    const kpis = screen.getByLabelText('Indicadores clave');
    await waitFor(() => expect(within(kpis).getByText('28')).toBeInTheDocument());

    await userEvent.type(within(filters).getByLabelText('Desde'), '2026-09-10');
    await userEvent.click(within(filters).getByLabelText('Descartado'));
    await userEvent.selectOptions(within(filters).getByLabelText('Diagrama'), 'd1');
    await waitFor(() =>
      expect(api.requests.map((r) => r.url)).toContain(
        `${URL}?diagramId=d1&type=non_functional&from=2026-09-10&status=pending&status=validated&status=discarded`,
      ),
    );
  });

  it('no deja quitar el último estado', async () => {
    dashboard();
    const filters = await screen.findByRole('form', { name: 'Filtros' });
    await userEvent.click(within(filters).getByLabelText('Pendiente'));
    await userEvent.click(within(filters).getByLabelText('Validado'));
    expect(within(filters).getByLabelText('Validado')).toBeChecked();
  });
});

describe('mapa de cobertura', () => {
  it('cada actividad es una zona con su número; al pulsarla se ven sus indicadores y el enlace', async () => {
    dashboard();
    const map = await screen.findByRole('region', { name: 'Mapa de cobertura' });
    const zone = await within(map).findByRole('button', { name: 'Validar pago: 24 detalles' });
    expect(zone).toHaveStyle({ left: '10%', top: '20%', width: '30%', height: '10%' });
    expect(within(map).getByRole('list', { name: 'Escala de color' })).toBeInTheDocument();
    await userEvent.click(zone);
    const panel = within(map).getByRole('status');
    expect(panel).toHaveTextContent('Validar pago');
    expect(panel).toHaveTextContent('24 detalles · 89 % del total');
    expect(
      within(panel).getByRole('link', { name: 'Ver sus requisitos en el diagrama' }),
    ).toHaveAttribute('href', '/proyectos/p1/diagramas/d1');
  });
});

describe('acceso (FR-001)', () => {
  it('un Participante ve el acceso denegado y no se piden los indicadores', async () => {
    const api = dashboard({ role: 'participant' });
    expect(await screen.findByRole('heading', { name: 'Acceso denegado' })).toBeInTheDocument();
    expect(
      screen.getByText('Solo los Administradores del proyecto pueden ver el dashboard.'),
    ).toBeInTheDocument();
    expect(api.requests.some((r) => r.url.startsWith(URL))).toBe(false);
  });

  it('sin el flag, la ruta no existe', async () => {
    dashboard({ flag: false });
    expect(await screen.findByRole('heading', { name: /no encontrada/i })).toBeInTheDocument();
  });

  it('el enlace Dashboard solo aparece al Administrador con el flag', async () => {
    renderAt('/proyectos/p1');
    expect(await screen.findByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/proyectos/p1/dashboard',
    );
  });

  it.each([
    ['participant', true],
    ['admin', false],
  ])('rol %s con flag %s: sin enlace', async (role, flag) => {
    renderAt('/proyectos/p1', { role, flag });
    expect(await screen.findByRole('link', { name: 'Diagramas' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();
  });
});
