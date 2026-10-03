import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AnalysisResults, AnalysisRun } from '@reqcanvas/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { sentimentOption } from '../src/features/dashboard/patterns/Sentiment';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi } from './helpers/api';

// US4 de la 007 (FR-008, FR-010, FR-011): sentimiento, reglas de asociación y actividades críticas.

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
const XSS = '<img src=x onerror=alert(1)>';

const run = (results: Partial<AnalysisResults> = {}): AnalysisRun => ({
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
  detailCount: 2,
  stale: false,
  newDetailsSinceRun: 0,
  error: null,
  createdAt: '2026-10-02T10:00:00.000Z',
  finishedAt: '2026-10-02T10:01:00.000Z',
  results: { ...RESULTS, ...results },
  input: {
    activities: [...INPUT.activities, { key: 'act-10', diagramId: 'd', label: 'Auditar accesos' }],
    details: INPUT.details,
  },
});

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

function renderDashboard(latest: AnalysisRun = run()) {
  mockApi({
    'GET /api/config': () => json(200, { flags: {} }),
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
    'GET /api/projects/p1/analysis-runs/latest': () => json(200, latest),
  });
  render(
    <AppProviders>
      <RouterProvider
        router={createMemoryRouter(routes, { initialEntries: ['/proyectos/p1/dashboard'] })}
      />
    </AppProviders>,
  );
}

async function open(name: string) {
  const region = await screen.findByRole('region', { name: 'Análisis de texto' });
  await userEvent.click(await within(region).findByRole('tab', { name }));
  return within(region).getByRole('tabpanel');
}

describe('sentimiento', () => {
  it('distribución por actividad con su tabla y los detalles más negativos', async () => {
    renderDashboard();
    const panel = await open('Sentimiento');
    const figure = within(panel).getByRole('figure', { name: 'Sentimiento por actividad' });
    expect(within(figure).getByText('2 de 13 detalles expresan malestar.')).toBeInTheDocument();
    const rows = within(figure).getAllByRole('row', { hidden: true });
    expect(rows.map((row) => row.textContent)).toEqual([
      'ActividadNegativoNeutroPositivo',
      'Validar pago2101',
    ]);
    const negatives = within(panel).getByRole('region', { name: 'Detalles más negativos' });
    const [first] = within(negatives).getAllByRole('listitem');
    expect(first).toHaveTextContent(
      /81\s% negativo · Validar pago · Dado el comprador eligió pagar/,
    );
    expect(within(first!).getByRole('link', { name: 'Ir al diagrama' })).toBeInTheDocument();
  });

  it('sin malestar lo dice, y el tooltip escapa los nombres', async () => {
    renderDashboard(
      run({
        sentiment: {
          byActivity: [{ activityKey: 'act-04', pos: 0, neu: 5, neg: 0 }],
          mostNegative: [],
        },
      }),
    );
    const panel = await open('Sentimiento');
    expect(
      within(panel).getByText('Ningún detalle expresa malestar con claridad.'),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole('region', { name: 'Detalles más negativos' })).toBeNull();

    const option = sentimentOption([{ activityKey: 'k', pos: 1, neu: 1, neg: 1 }], {
      projectId: 'p1',
      detail: () => undefined,
      activityLabel: () => XSS,
      detailsOf: () => 0,
    }) as { tooltip: { formatter: (params: object[]) => string }; series: Array<{ name: string }> };
    expect(
      option.tooltip.formatter([{ axisValueLabel: XSS, seriesName: 'Negativo', value: 1 }]),
    ).not.toContain('<img');
    expect(option.series.map((series) => series.name)).toEqual(['Negativo', 'Neutro', 'Positivo']);
  });
});

describe('patrones', () => {
  it('cada regla con su frase, soporte y confianza', async () => {
    renderDashboard();
    const panel = await open('Patrones');
    const row = within(panel).getByRole('row', {
      name: /Cuando la etiqueta es pagos, el 90 % de los requisitos son no funcionales\./,
    });
    const cells = within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cells[0]).toMatch(/^22\s%$/);
    expect(cells[1]).toMatch(/^90\s%$/);
    expect(cells[2]).toBe('2,4');
  });

  it('sin reglas lo indica', async () => {
    renderDashboard(run({ association: [] }));
    const panel = await open('Patrones');
    expect(
      within(panel).getByText(
        'No se encontraron patrones claros entre etiquetas, tipos y actividades.',
      ),
    ).toBeInTheDocument();
  });
});

describe('actividades críticas', () => {
  it('calientes y frías, cada una con su motivo', async () => {
    renderDashboard();
    const panel = await open('Actividades críticas');
    const hot = within(panel).getByRole('region', { name: 'Actividades calientes' });
    expect(within(hot).getByRole('heading')).toHaveTextContent('Actividades calientes (1)');
    expect(within(hot).getByRole('listitem')).toHaveTextContent('Validar pago: volumen');
    const cold = within(panel).getByRole('region', { name: 'Actividades frías' });
    expect(within(cold).getByRole('listitem')).toHaveTextContent('Auditar accesos: sin detalles');
  });

  it('sin actividades destacadas lo dice', async () => {
    renderDashboard(
      run({
        hotcold: [
          { activityKey: 'act-04', class: 'normal', score: 0, reason: 'dentro de lo habitual' },
        ],
      }),
    );
    const panel = await open('Actividades críticas');
    expect(
      within(panel).getByText('Ninguna actividad destaca sobre las demás.'),
    ).toBeInTheDocument();
    expect(within(panel).getByText('Todas las actividades tienen aportes.')).toBeInTheDocument();
  });
});
