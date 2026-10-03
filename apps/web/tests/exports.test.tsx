import type { Export } from '@reqcanvas/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { polling } from '../src/features/exports/useExport';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi, type Handler } from './helpers/api';

// US1–US3 de la 008 (FR-001, FR-002, FR-004, FR-005, FR-006, FR-007): menú Exportar del dashboard.

vi.mock('../src/features/dashboard/charts/EChart', () => ({
  default: () => <div data-testid="echart" />,
}));

const EXPORTS = '/api/projects/p1/exports';
const saved: Array<{ name: string; text: string }> = [];
let intervalMs: number;

beforeEach(() => {
  useAuthStore.getState().setSession({
    accessToken: 'token-1',
    expiresIn: 900,
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  });
  saved.length = 0;
  intervalMs = polling.intervalMs;
  polling.intervalMs = 20;
  // jsdom no descarga archivos: se captura lo que la app entrega al navegador.
  const blobs = new Map<string, Blob>();
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.getAttribute('href') ?? '');
    void blob?.text().then((text) => saved.push({ name: this.download, text }));
  });
});
afterEach(() => {
  polling.intervalMs = intervalMs;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

const file = (name: string, body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'x-export-id': 'e0',
      ...headers,
    },
  });

const exported = (overrides: Partial<Export> = {}): Export => ({
  id: 'e1',
  projectId: 'p1',
  format: 'xlsx',
  mode: 'async',
  status: 'pending',
  expired: false,
  detailCount: 1200,
  fileName: 'reqcanvas-tienda-demo-20261003-1000.xlsx',
  bytes: null,
  error: null,
  createdAt: '2026-10-03T15:00:00.000Z',
  finishedAt: null,
  expiresAt: null,
  ...overrides,
});

function renderDashboard(
  handlers: Record<string, Handler | Handler[]> = {},
  { role = 'admin' } = {},
) {
  const api = mockApi({
    'GET /api/config': () => json(200, { flags: {} }),
    'GET /api/projects/p1': () =>
      json(200, {
        id: 'p1',
        name: 'Tienda demo',
        description: '',
        status: 'open',
        myRole: role,
        lastActivityAt: '2026-09-30T10:00:00.000Z',
        memberCount: 6,
        createdAt: '2026-09-30T09:00:00.000Z',
      }),
    'GET /api/projects/p1/diagrams': () => json(200, []),
    'GET /api/projects/p1/dashboard/descriptive': () =>
      json(200, {
        kpis: {
          totalDetails: 2,
          activeParticipants: 1,
          coveredActivitiesPct: 100,
          validatedPct: 50,
        },
        byActivity: [],
        byType: [],
        byPriority: [],
        byRole: [],
        byStatus: [],
        timeline: [],
      }),
    ...handlers,
  });
  render(
    <AppProviders>
      <RouterProvider
        router={createMemoryRouter(routes, { initialEntries: ['/proyectos/p1/dashboard'] })}
      />
    </AppProviders>,
  );
  return api;
}

const menu = () => screen.findByRole('region', { name: 'Exportar' });
const posted = (api: ReturnType<typeof mockApi>) =>
  api.requests.filter((request) => request.method === 'POST' && request.url === EXPORTS);

describe('quién ve el menú', () => {
  it('el Administrador', async () => {
    renderDashboard();
    const region = await menu();
    expect(within(region).getByRole('button', { name: 'Exportar a Excel' })).toBeEnabled();
    expect(within(region).getByRole('button', { name: 'Exportar a CSV' })).toBeEnabled();
  });

  it('un Participante no ve el dashboard ni el menú', async () => {
    renderDashboard({}, { role: 'participant' });
    expect(await screen.findByRole('heading', { name: 'Acceso denegado' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Exportar' })).toBeNull();
  });
});

describe('exportación inmediata', () => {
  it('Excel envía los filtros activos y entrega el archivo con su nombre', async () => {
    const api = renderDashboard({
      [`POST ${EXPORTS}`]: () => file('reqcanvas-tienda-demo-20261003-1000.xlsx', 'libro'),
    });
    const region = await menu();
    // Se quita «Pendiente» en los filtros del dashboard: la exportación usa los mismos.
    await userEvent.click(
      within(screen.getByRole('form', { name: 'Filtros' })).getByRole('checkbox', {
        name: 'Pendiente',
      }),
    );
    await userEvent.click(within(region).getByRole('button', { name: 'Exportar a Excel' }));
    await waitFor(() =>
      expect(saved).toEqual([{ name: 'reqcanvas-tienda-demo-20261003-1000.xlsx', text: 'libro' }]),
    );
    expect(posted(api)[0]!.body).toEqual({
      format: 'xlsx',
      filters: { diagramIds: null, from: null, to: null, types: null, statuses: ['validated'] },
    });
    expect(posted(api)[0]!.auth).toBe('Bearer token-1');
    expect(within(region).queryByRole('status')).toBeNull();
  });

  it('CSV envía el separador elegido', async () => {
    const api = renderDashboard({ [`POST ${EXPORTS}`]: () => file('reqcanvas.csv', '"ID"') });
    const region = await menu();
    await userEvent.selectOptions(
      within(region).getByLabelText('Separador del CSV'),
      'Punto y coma',
    );
    await userEvent.click(within(region).getByRole('button', { name: 'Exportar a CSV' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(posted(api)[0]!.body).toMatchObject({
      format: 'csv',
      options: { delimiter: 'semicolon' },
    });
  });

  it('sin requisitos con esos filtros lo avisa, y el archivo se entrega igual', async () => {
    renderDashboard({
      [`POST ${EXPORTS}`]: () => file('reqcanvas.csv', '"ID"', { 'x-export-empty': 'true' }),
    });
    const region = await menu();
    await userEvent.click(within(region).getByRole('button', { name: 'Exportar a CSV' }));
    expect(await within(region).findByRole('status')).toHaveTextContent(
      'No hay requisitos con estos filtros',
    );
    await waitFor(() => expect(saved).toHaveLength(1));
  });

  it('Gherkin envía «Incluir pendientes» y entrega el ZIP', async () => {
    const api = renderDashboard({
      [`POST ${EXPORTS}`]: () => file('reqcanvas-tienda-demo-gherkin.zip', 'zip'),
    });
    const region = await menu();
    await userEvent.click(within(region).getByRole('button', { name: 'Exportar a Gherkin' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(posted(api)[0]!.body).toMatchObject({
      format: 'gherkin',
      options: { includePending: false },
    });

    await userEvent.click(within(region).getByRole('checkbox', { name: 'Incluir pendientes' }));
    await userEvent.click(within(region).getByRole('button', { name: 'Exportar a Gherkin' }));
    await waitFor(() =>
      expect(saved).toEqual(
        Array(2).fill({ name: 'reqcanvas-tienda-demo-gherkin.zip', text: 'zip' }),
      ),
    );
    expect(posted(api)[1]!.body).toMatchObject({
      format: 'gherkin',
      options: { includePending: true },
    });
  });

  it('Gherkin sin requisitos validados sugiere incluir los pendientes', async () => {
    renderDashboard({
      [`POST ${EXPORTS}`]: () => file('reqcanvas.zip', 'zip', { 'x-export-empty': 'true' }),
    });
    const region = await menu();
    await userEvent.click(within(region).getByRole('button', { name: 'Exportar a Gherkin' }));
    expect(await within(region).findByRole('status')).toHaveTextContent(
      'No hay requisitos validados con estos filtros',
    );
    await waitFor(() => expect(saved).toHaveLength(1));
  });

  it('un error muestra su mensaje', async () => {
    renderDashboard({
      [`POST ${EXPORTS}`]: () =>
        json(409, {
          code: 'EXPORT_IN_PROGRESS',
          message: 'Ya hay una exportación de este formato en preparación.',
        }),
    });
    const region = await menu();
    await userEvent.click(within(region).getByRole('button', { name: 'Exportar a Excel' }));
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'Ya hay una exportación de este formato en preparación.',
    );
    expect(saved).toEqual([]);
  });
});

describe('exportación en segundo plano', () => {
  it('avisa mientras se prepara, consulta el estado y permite descargarla al terminar', async () => {
    const done = exported({
      status: 'done',
      bytes: 4096,
      finishedAt: '2026-10-03T15:00:05.000Z',
      expiresAt: '2026-10-04T15:00:05.000Z',
    });
    const api = renderDashboard({
      [`POST ${EXPORTS}`]: () => json(202, exported()),
      'GET /api/exports/e1': [
        () => json(200, exported({ status: 'running' })),
        () => json(200, done),
      ],
      'GET /api/exports/e1/download': () => file(done.fileName!, 'libro grande'),
    });
    const region = await menu();
    await userEvent.click(within(region).getByRole('button', { name: 'Exportar a Excel' }));
    expect(await within(region).findByText('Preparando la exportación…')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Exportar a CSV' })).toBeDisabled();

    expect(await within(region).findByText(/Tu exportación está lista\./)).toBeInTheDocument();
    expect(saved).toEqual([]);
    expect(within(region).getByRole('button', { name: 'Exportar a CSV' })).toBeEnabled();
    await userEvent.click(within(region).getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(saved).toEqual([{ name: done.fileName, text: 'libro grande' }]));
    expect(api.requests.filter((r) => r.url === '/api/exports/e1').length).toBeGreaterThan(0);
  });

  it('Reporte PDF: muestra el progreso, avisa cuando está listo y permite descargarlo', async () => {
    const pending = exported({
      format: 'pdf',
      detailCount: 80,
      fileName: 'reqcanvas-tienda-demo-20261003-1000.pdf',
    });
    const done = { ...pending, status: 'done' as const, bytes: 482133 };
    const api = renderDashboard({
      [`POST ${EXPORTS}`]: () => json(202, pending),
      'GET /api/exports/e1': [
        () => json(200, { ...pending, status: 'running' }),
        () => json(200, done),
      ],
      'GET /api/exports/e1/download': () => file(done.fileName!, '%PDF'),
    });
    const region = await menu();
    await userEvent.click(within(region).getByRole('button', { name: 'Generar reporte PDF' }));
    expect(await within(region).findByText('Generando el reporte PDF…')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Generar reporte PDF' })).toBeDisabled();
    expect(posted(api)[0]!.body).toMatchObject({ format: 'pdf' });

    expect(await within(region).findByText(/Tu exportación está lista\./)).toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(saved).toEqual([{ name: done.fileName, text: '%PDF' }]));
  });

  it.each([
    [422, 'NO_DIAGRAMS', 'El reporte necesita al menos un diagrama publicado.'],
    [
      503,
      'WORKER_UNAVAILABLE',
      'El generador de reportes no está disponible. Inténtalo de nuevo en unos minutos.',
    ],
  ])('Reporte PDF: %i %s muestra su mensaje', async (status, code, message) => {
    renderDashboard({ [`POST ${EXPORTS}`]: () => json(status, { code, message }) });
    const region = await menu();
    await userEvent.click(within(region).getByRole('button', { name: 'Generar reporte PDF' }));
    expect(await within(region).findByRole('alert')).toHaveTextContent(message);
    expect(within(region).getByRole('button', { name: 'Generar reporte PDF' })).toBeEnabled();
    expect(saved).toEqual([]);
  });

  it('si falla muestra el motivo', async () => {
    renderDashboard({
      [`POST ${EXPORTS}`]: () => json(202, exported()),
      'GET /api/exports/e1': () =>
        json(
          200,
          exported({
            status: 'failed',
            error: { code: 'EXPORT_FAILED', message: 'No se pudo generar la exportación.' },
          }),
        ),
    });
    const region = await menu();
    await userEvent.click(within(region).getByRole('button', { name: 'Exportar a Excel' }));
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'No se pudo generar la exportación.',
    );
  });
});

describe('historial', () => {
  it('muestra formato, requisitos, tamaño y estado, y solo deja descargar las disponibles', async () => {
    renderDashboard({
      [`GET ${EXPORTS}`]: () =>
        json(200, [
          exported({ id: 'e1', status: 'done', bytes: 4096 }),
          exported({ id: 'e2', status: 'done', bytes: 2048, expired: true, format: 'csv' }),
          exported({ id: 'e3', mode: 'sync', status: 'done', detailCount: 80, format: 'csv' }),
          exported({ id: 'e4', status: 'running' }),
          exported({
            id: 'e5',
            status: 'failed',
            error: { code: 'EXPORT_FAILED', message: 'No se pudo generar la exportación.' },
          }),
        ]),
      'GET /api/exports/e1/download': () => file('grande.xlsx', 'contenido'),
    });
    const region = await menu();
    await userEvent.click(
      within(region).getByRole('button', { name: 'Historial de exportaciones' }),
    );
    const items = within(
      await within(region).findByRole('list', { name: 'Historial de exportaciones' }),
    ).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent(/Excel.*1\.?200 requisitos.*4 KB.*Lista/);
    expect(items[1]).toHaveTextContent(/CSV.*2 KB.*Caducada/);
    expect(items[2]).toHaveTextContent(/CSV.*80 requisitos.*Descargada al momento/);
    expect(items[3]).toHaveTextContent('En preparación');
    expect(items[4]).toHaveTextContent('Fallida');
    expect(items[4]).toHaveTextContent('No se pudo generar la exportación.');
    expect(within(region).getAllByRole('button', { name: 'Descargar' })).toHaveLength(1);
    await userEvent.click(within(items[0]!).getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(saved).toEqual([{ name: 'grande.xlsx', text: 'contenido' }]));
  });

  it('sin exportaciones lo indica', async () => {
    renderDashboard({ [`GET ${EXPORTS}`]: () => json(200, []) });
    const region = await menu();
    await userEvent.click(
      within(region).getByRole('button', { name: 'Historial de exportaciones' }),
    );
    expect(await within(region).findByText('Aún no hay exportaciones.')).toBeInTheDocument();
  });
});
