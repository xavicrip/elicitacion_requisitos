import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AnalysisResults, AnalysisRun } from '@reqcanvas/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { polling } from '../src/features/dashboard/analysis/useAnalysisRun';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi, type Handler } from './helpers/api';

// US5 de la 007 (FR-012, SC-006): insights en lenguaje natural con sus evidencias.

vi.mock('../src/features/dashboard/charts/EChart', () => ({
  default: () => <div data-testid="echart" />,
}));

const example = <T,>(name: string) =>
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), `../analytics/tests/contract/examples/analysis/${name}.json`),
      'utf8',
    ),
  ) as T;
const RESULTS = example<AnalysisResults>('results');
const INPUT = example<NonNullable<AnalysisRun['input']>>('input-file');
const DETAIL = INPUT.details[1]!;
const XSS = '<img src=x onerror=alert(1)>';
const LATEST = '/api/projects/p1/analysis-runs/latest';

const insights: NonNullable<AnalysisResults['insights']> = [
  {
    id: 'i1',
    title: 'Validar pago concentra los no funcionales',
    statement: 'La actividad Validar pago reúne el 90 % de los requisitos no funcionales.',
    recommendation: 'Revisa con el equipo los tiempos de respuesta de la pasarela.',
    evidence: [
      { kind: 'activity', id: 'act-04' },
      { kind: 'rule', id: '0' },
      { kind: 'topic', id: 't0' },
      { kind: 'quality', id: DETAIL.id },
      { kind: 'kpi', id: 'type:non_functional' },
    ],
  },
  {
    id: 'i2',
    title: XSS,
    statement: `Un hallazgo con ${XSS}`,
    evidence: [{ kind: 'detail', id: DETAIL.id }],
  },
];

const run = (
  overrides: Partial<AnalysisRun> = {},
  results: Partial<AnalysisResults> = {},
): AnalysisRun => ({
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
  stages: { ...RESULTS.stages, insights: { status: 'done' } },
  detailCount: 2,
  stale: false,
  newDetailsSinceRun: 0,
  error: null,
  createdAt: '2026-10-02T10:00:00.000Z',
  finishedAt: '2026-10-02T10:01:00.000Z',
  results: { ...RESULTS, insights, ...results },
  input: { activities: INPUT.activities, details: INPUT.details },
  ...overrides,
});

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

function renderDashboard(
  handlers: Record<string, Handler | Handler[]> = {},
  flags: Record<string, boolean> = { dashboard: true, insights: true },
) {
  const api = mockApi({
    'GET /api/config': () => json(200, { flags }),
    'GET /api/projects/p1': () =>
      json(200, {
        id: 'p1',
        name: 'Tienda demo',
        description: '',
        status: 'open',
        myRole: 'admin',
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
    [`GET ${LATEST}`]: () => json(200, run()),
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

/** El resumen es la primera pestaña: se muestra al cargar. */
async function panel() {
  const region = await screen.findByRole('region', { name: 'Análisis de texto' });
  await within(region).findByRole('tab', { name: 'Resumen', selected: true });
  return within(region).getByRole('tabpanel');
}

describe('resumen de hallazgos', () => {
  it('lista cada insight con su afirmación y su recomendación, como texto plano', async () => {
    renderDashboard();
    const list = within(await panel()).getByRole('list', { name: 'Hallazgos' });
    const [first, second] = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.querySelector('h3'));
    expect(within(first!).getByRole('heading')).toHaveTextContent(
      'Validar pago concentra los no funcionales',
    );
    expect(first).toHaveTextContent('reúne el 90 % de los requisitos no funcionales.');
    expect(first).toHaveTextContent(
      'Recomendación: Revisa con el equipo los tiempos de respuesta de la pasarela.',
    );
    expect(within(second!).getByRole('heading')).toHaveTextContent(XSS);
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('«Ver los datos» muestra las evidencias con los datos reales del análisis', async () => {
    renderDashboard();
    const view = within(await panel());
    await userEvent.click(view.getAllByRole('button', { name: /^Ver los datos/ })[0]!);
    const evidence = view.getByRole('region', { name: 'Datos que lo sustentan' });
    const items = within(evidence)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items[0]).toBe('Actividad Validar pago: 2 detalles');
    expect(items[1]).toBe(
      'Cuando la etiqueta es pagos, el 90 % de los requisitos son no funcionales.',
    );
    expect(items[2]).toBe('Tema pago · tarjeta · pasarela: 1 detalles');
    expect(items[3]).toMatch(/^Puntaje 70 de 100 · Validar pago · Dado el comprador eligió pagar/);
    expect(items[4]).toBe('Indicador: Detalles de tipo No funcional');
    expect(within(evidence).getByRole('link', { name: 'Ir al diagrama' })).toBeInTheDocument();
  });

  it('«No útil» lo registra y el insight desaparece', async () => {
    const api = renderDashboard({
      [`GET ${LATEST}`]: [
        () => json(200, run()),
        () => json(200, run({}, { insights: [insights[1]!] })),
      ],
      'POST /api/analysis-runs/r1/insights/i1/feedback': () => new Response(null, { status: 204 }),
    });
    const view = within(await panel());
    await userEvent.click(view.getAllByRole('button', { name: 'No útil' })[0]!);
    await waitFor(() =>
      expect(api.requests.find((r) => r.method === 'POST')?.body).toEqual({ useful: false }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Validar pago concentra los no funcionales')).toBeNull(),
    );
  });

  it('«Regenerar resumen» lanza solo esa etapa y sigue su progreso', async () => {
    const pending = run({
      id: 'r2',
      kind: 'insights',
      status: 'pending',
      results: undefined,
      input: undefined,
    });
    const api = renderDashboard({
      'POST /api/analysis-runs/r1/insights/regenerate': () => json(202, pending),
      'GET /api/analysis-runs/r2': () =>
        json(200, { ...pending, status: 'running', progress: { stage: 'insights', pct: 0 } }),
    });
    const view = within(await panel());
    await userEvent.click(view.getByRole('button', { name: 'Regenerar resumen' }));
    expect(await screen.findByText('Analizando: resumen de hallazgos (0 %)')).toBeInTheDocument();
    expect(api.requests.some((r) => r.url === '/api/analysis-runs/r1/insights/regenerate')).toBe(
      true,
    );
  });

  it('avisa si solo quedaron los hallazgos que se pudieron comprobar', async () => {
    renderDashboard({
      [`GET ${LATEST}`]: () => json(200, run({}, { insightsFewerThanExpected: true })),
    });
    expect(
      await within(await panel()).findByText(
        'Solo se muestran los hallazgos que se pudieron comprobar con los datos.',
      ),
    ).toBeInTheDocument();
  });
});

describe('resumen no disponible (US5-4)', () => {
  it('sin el servicio lo indica y el resto del dashboard sigue funcionando', async () => {
    const stages = { ...RESULTS.stages, insights: { status: 'skipped', reason: 'NO_API_KEY' } };
    renderDashboard(
      {
        [`GET ${LATEST}`]: () =>
          json(200, run({ stages } as Partial<AnalysisRun>, { insights: undefined })),
      },
      { dashboard: true },
    );
    const view = within(await panel());
    expect(
      view.getByText(
        'El resumen no está disponible en este entorno. El resto del análisis está completo.',
      ),
    ).toBeInTheDocument();
    // Sin el flag `insights` no se ofrece generarlo.
    expect(view.queryByRole('button', { name: /resumen/i })).toBeNull();
    const region = screen.getByRole('region', { name: 'Análisis de texto' });
    await userEvent.click(within(region).getByRole('tab', { name: 'Temas' }));
    expect(within(region).getByRole('list', { name: 'Temas' })).toBeInTheDocument();
  });

  it('si falló al generarse, permite volver a intentarlo', async () => {
    const stages = { ...RESULTS.stages, insights: { status: 'failed', error: 'APITimeoutError' } };
    renderDashboard({
      [`GET ${LATEST}`]: () =>
        json(200, run({ stages, partial: true } as Partial<AnalysisRun>, { insights: undefined })),
    });
    const view = within(await panel());
    expect(
      view.getByText(/El resumen no está disponible: no se pudo generar esta vez\./),
    ).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Generar resumen' })).toBeEnabled();
  });

  it('un error al regenerar se muestra', async () => {
    renderDashboard({
      'POST /api/analysis-runs/r1/insights/regenerate': () =>
        json(409, {
          code: 'INSIGHTS_DISABLED',
          message: 'El resumen de hallazgos no está activado en este entorno.',
        }),
    });
    const view = within(await panel());
    await userEvent.click(view.getByRole('button', { name: 'Regenerar resumen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El resumen de hallazgos no está activado en este entorno.',
    );
  });
});
