import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AnalysisResults, AnalysisRun } from '@reqcanvas/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { polling } from '../src/features/dashboard/analysis/useAnalysisRun';
import { graphOption } from '../src/features/dashboard/text/CooccurrenceGraph';
import { wordCloudOption } from '../src/features/dashboard/text/WordCloud';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi, type Handler } from './helpers/api';

// US2 de la 007 (FR-005, FR-006, FR-013, FR-014): lanzar el análisis, ver el progreso y explorar
// los resultados. El lienzo de ECharts se sustituye por un doble.

vi.mock('../src/features/dashboard/charts/EChart', () => ({
  default: () => <div data-testid="echart" />,
}));

// Los mismos ejemplos del contrato que validan `shared` y `analytics`.
const example = <T,>(name: string) =>
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), `../analytics/tests/contract/examples/analysis/${name}.json`),
      'utf8',
    ),
  ) as T;
const RESULTS = example<AnalysisResults>('results');
const INPUT = example<NonNullable<AnalysisRun['input']>>('input-file');

const LATEST = '/api/projects/p1/analysis-runs/latest';
const RUNS = '/api/projects/p1/analysis-runs';
const XSS = '<img src=x onerror=alert(1)>';

const run = (overrides: Partial<AnalysisRun> = {}): AnalysisRun => ({
  id: 'r1',
  projectId: 'p1',
  status: 'done',
  partial: false,
  kind: 'full',
  trigger: 'manual',
  progress: null,
  filters: {
    diagramIds: null,
    from: null,
    to: null,
    types: null,
    statuses: ['pending', 'validated'],
  },
  stages: RESULTS.stages,
  detailCount: 80,
  stale: false,
  newDetailsSinceRun: 0,
  error: null,
  createdAt: '2026-10-02T10:00:00.000Z',
  finishedAt: '2026-10-02T10:01:00.000Z',
  results: RESULTS,
  input: { activities: INPUT.activities, details: INPUT.details },
  ...overrides,
});

const project = {
  id: 'p1',
  name: 'Tienda demo',
  description: '',
  status: 'open',
  myRole: 'admin',
  lastActivityAt: '2026-09-30T10:00:00.000Z',
  memberCount: 6,
  createdAt: '2026-09-30T09:00:00.000Z',
};
const descriptive = {
  kpis: { totalDetails: 80, activeParticipants: 6, coveredActivitiesPct: 90, validatedPct: 15 },
  byActivity: [],
  byType: [],
  byPriority: [],
  byRole: [],
  byStatus: [],
  timeline: [],
};

beforeEach(() => {
  polling.intervalMs = 20;
  useAuthStore.getState().setSession({
    accessToken: 'token-1',
    expiresIn: 900,
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  });
});
afterEach(() => {
  polling.intervalMs = 3000;
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

function renderDashboard(handlers: Record<string, Handler | Handler[]> = {}) {
  const api = mockApi({
    'GET /api/config': () => json(200, { flags: {} }),
    'GET /api/projects/p1': () => json(200, project),
    'GET /api/projects/p1/diagrams': () => json(200, []),
    'GET /api/projects/p1/dashboard/descriptive': () => json(200, descriptive),
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

const section = () => screen.findByRole('region', { name: 'Análisis de texto' });

describe('lanzar el análisis', () => {
  it('sin análisis previo lo indica; al ejecutarlo consulta el progreso hasta terminar', async () => {
    const api = renderDashboard({
      [`GET ${LATEST}`]: [
        () => json(404, { code: 'NOT_FOUND', message: 'Todavía no hay ningún análisis.' }),
        () => json(200, run()),
      ],
      [`POST ${RUNS}`]: () =>
        json(202, run({ status: 'pending', results: undefined, input: undefined })),
      'GET /api/analysis-runs/r1': [
        () =>
          json(
            200,
            run({
              status: 'running',
              progress: { stage: 'topics', pct: 30 },
              results: undefined,
              input: undefined,
            }),
          ),
        () => json(200, run()),
      ],
    });
    const region = await section();
    expect(
      await within(region).findByText('Aún no se ha ejecutado ningún análisis de este proyecto.'),
    ).toBeInTheDocument();

    await userEvent.click(within(region).getByRole('button', { name: 'Ejecutar análisis' }));
    expect(await within(region).findByText('Analizando: temas (30 %)')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Ejecutar análisis' })).toBeDisabled();
    expect(api.requests.find((r) => r.method === 'POST')?.body).toEqual({
      filters: {
        diagramIds: null,
        from: null,
        to: null,
        types: null,
        statuses: ['pending', 'validated'],
      },
    });

    expect(
      await within(region).findByRole('tablist', { name: 'Resultados del análisis' }),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(
        /Último análisis: .* · 80 detalles · Calculado con estados: pendiente, validado\./,
      ),
    ).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Ejecutar análisis' })).toBeEnabled();
    // Terminado, deja de consultar.
    const polls = () => api.requests.filter((r) => r.url === '/api/analysis-runs/r1').length;
    const before = polls();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(polls()).toBe(before);
  });

  it('si ya hay un análisis en curso (409), sigue ese', async () => {
    renderDashboard({
      [`POST ${RUNS}`]: () =>
        json(409, {
          code: 'ANALYSIS_IN_PROGRESS',
          message: 'Ya hay un análisis en curso.',
          runId: 'r9',
        }),
      'GET /api/analysis-runs/r9': () =>
        json(
          200,
          run({
            id: 'r9',
            status: 'running',
            progress: { stage: 'download', pct: 0 },
            results: undefined,
            input: undefined,
          }),
        ),
    });
    const region = await section();
    await userEvent.click(within(region).getByRole('button', { name: 'Ejecutar análisis' }));
    expect(
      await within(region).findByText('Analizando: leyendo los detalles (0 %)'),
    ).toBeInTheDocument();
  });

  it('un análisis fallido muestra su mensaje y deja volver a intentarlo', async () => {
    renderDashboard({
      [`POST ${RUNS}`]: () =>
        json(202, run({ status: 'pending', results: undefined, input: undefined })),
      'GET /api/analysis-runs/r1': () =>
        json(
          200,
          run({
            status: 'failed',
            results: undefined,
            input: undefined,
            error: {
              code: 'TIMEOUT',
              message: 'El análisis tardó demasiado. Vuelve a intentarlo más tarde.',
            },
          }),
        ),
    });
    const region = await section();
    await userEvent.click(within(region).getByRole('button', { name: 'Ejecutar análisis' }));
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'El análisis tardó demasiado.',
    );
    await waitFor(() =>
      expect(within(region).getByRole('button', { name: 'Ejecutar análisis' })).toBeEnabled(),
    );
  });
});

describe('avisos', () => {
  it('análisis desactualizado: indica cuántos detalles nuevos hay y permite relanzarlo', async () => {
    const api = renderDashboard({
      [`GET ${LATEST}`]: () => json(200, run({ stale: true, newDetailsSinceRun: 3 })),
      [`POST ${RUNS}`]: () =>
        json(202, run({ id: 'r2', status: 'pending', results: undefined, input: undefined })),
      'GET /api/analysis-runs/r2': () =>
        json(200, run({ id: 'r2', status: 'running', results: undefined, input: undefined })),
    });
    const region = await section();
    expect(
      await within(region).findByText(/Análisis desactualizado: 3 detalles nuevos o modificados/),
    ).toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Volver a analizar' }));
    await waitFor(() => expect(api.requests.some((r) => r.method === 'POST')).toBe(true));
  });

  it('datos insuficientes, etapas fallidas y texto no reconocido', async () => {
    const stages = {
      keywords: { status: 'done' },
      topics: { status: 'skipped', reason: 'INSUFFICIENT_DATA' },
      sentiment: { status: 'failed', error: 'OSError' },
    } as AnalysisRun['stages'];
    renderDashboard({
      [`GET ${LATEST}`]: () =>
        json(
          200,
          run({
            partial: true,
            stages,
            results: {
              schemaVersion: 1,
              stages,
              preprocess: { unrecognizedRatio: 0.35 },
              keywords: RESULTS.keywords,
            },
          }),
        ),
    });
    const region = await section();
    expect(
      await within(region).findByText(/Datos insuficientes: con menos de 20 detalles/),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(
        'No se pudo calcular: sentimiento. El resto del análisis está completo.',
      ),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(/El 35 % del texto no se reconoció como español/),
    ).toBeInTheDocument();
    const tabs = within(region)
      .getAllByRole('tab')
      .map((tab) => tab.textContent);
    expect(tabs).toEqual(['Palabras clave', 'Nube de palabras']);
  });
});

describe('resultados', () => {
  const withResults = () => renderDashboard({ [`GET ${LATEST}`]: () => json(200, run()) });
  const open = async (name: string) => {
    const region = await section();
    await userEvent.click(await within(region).findByRole('tab', { name }));
    return within(region).getByRole('tabpanel');
  };

  it('palabras clave de la actividad elegida, de mayor a menor', async () => {
    withResults();
    const panel = await open('Palabras clave');
    expect(within(panel).getByLabelText('Actividad')).toHaveDisplayValue('Validar pago');
    const terms = within(
      within(panel).getByRole('list', { name: 'Términos distintivos de Validar pago' }),
    ).getAllByRole('listitem');
    expect(terms.map((term) => term.textContent)).toEqual(['tarjeta', 'pasarela']);
  });

  it('nube y red: cada una con su tabla alternativa', async () => {
    withResults();
    let panel = await open('Nube de palabras');
    const cloud = within(panel).getByRole('figure', { name: 'Palabras más frecuentes' });
    expect(
      within(cloud).getByText('La más frecuente: «pago», en 34 ocasiones.'),
    ).toBeInTheDocument();
    expect(within(cloud).getAllByRole('row', { hidden: true })).toHaveLength(3);
    panel = await open('Términos relacionados');
    const graph = within(panel).getByRole('figure', { name: 'Términos que aparecen juntos' });
    expect(
      within(graph).getByText('El par más frecuente: «pago» y «tarjeta», juntos en 9 detalles.'),
    ).toBeInTheDocument();
  });

  it('temas con sus términos, detalles y actividades', async () => {
    withResults();
    const panel = await open('Temas');
    const topic = within(panel).getByRole('listitem', { name: 'Tema 1' });
    expect(
      within(topic).getByRole('heading', { name: 'Tema 1: pago · tarjeta · pasarela' }),
    ).toBeInTheDocument();
    expect(topic).toHaveTextContent('1 detalle · Actividades: Validar pago');
    expect(topic).toHaveTextContent('Términos: pago');
    expect(topic).toHaveTextContent(
      /Dado el cliente eligió pagar con tarjeta de crédito, cuando confirma el pago/,
    );
  });

  it('grupos: al elegir uno se ven sus detalles con el acceso al diagrama', async () => {
    withResults();
    const panel = await open('Grupos');
    expect(within(panel).getByText(/1 grupos reúnen 2 de los 3 detalles/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Grupo 1 · 2 detalles' }));
    const details = within(panel).getByRole('region', { name: 'Detalles del grupo' });
    expect(within(details).getAllByRole('listitem')).toHaveLength(2);
    expect(within(details).getAllByRole('link', { name: 'Ir al diagrama' })[0]).toHaveAttribute(
      'href',
      '/proyectos/p1/diagramas/66f100000000000000000001',
    );
  });

  it('el texto de los detalles se muestra como texto, también en los tooltips', async () => {
    renderDashboard({
      [`GET ${LATEST}`]: () =>
        json(
          200,
          run({
            results: {
              ...RESULTS,
              keywords: {
                byActivity: [{ activityKey: 'act-04', terms: [{ term: XSS, weight: 1 }] }],
              },
            },
          }),
        ),
    });
    const panel = await open('Palabras clave');
    expect(within(panel).getByText(XSS)).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();

    const cloud = wordCloudOption([{ term: XSS, weight: 2 }]) as {
      tooltip: { formatter: (params: { name: string; value: number }) => string };
    };
    expect(cloud.tooltip.formatter({ name: XSS, value: 2 })).not.toContain('<img');
    const graph = graphOption({
      nodes: [{ id: XSS, freq: 3, community: 0 }],
      edges: [{ source: XSS, target: 'pago', pmi: 1, count: 3 }],
    }) as {
      tooltip: { formatter: (params: object) => string };
    };
    expect(
      graph.tooltip.formatter({ dataType: 'node', name: XSS, value: 3, data: {} }),
    ).not.toContain('<img');
    expect(
      graph.tooltip.formatter({
        dataType: 'edge',
        name: '',
        value: 3,
        data: { source: XSS, target: 'pago' },
      }),
    ).not.toContain('<img');
  });
});
