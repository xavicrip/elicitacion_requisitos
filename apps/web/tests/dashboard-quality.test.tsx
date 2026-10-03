import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AnalysisResults, AnalysisRun } from '@reqcanvas/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi, type Handler } from './helpers/api';

// US3 de la 007 (FR-007, FR-009, FR-015): calidad de los requisitos y posibles duplicados.

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
const [A, B] = [INPUT.details[0]!, INPUT.details[1]!];
const XSS = '<img src=x onerror=alert(1)>';

const LATEST = '/api/projects/p1/analysis-runs/latest';
const DECISIONS = '/api/projects/p1/duplicate-decisions';
const SETTINGS = '/api/projects/p1/analysis-settings';

const quality: NonNullable<AnalysisResults['quality']> = [
  { detailId: A.id, score: 100, issues: [] },
  {
    detailId: B.id,
    score: 60,
    issues: [
      {
        code: 'ambiguous_term',
        field: 'then',
        term: 'rápido',
        penalty: 15,
        suggestion: 'Hazlo medible: indica una cifra, un tiempo o un criterio comprobable.',
      },
      {
        code: 'not_measurable',
        field: 'then',
        penalty: 15,
        suggestion: 'Un requisito no funcional necesita una cifra que se pueda comprobar.',
      },
      {
        code: 'too_short',
        field: 'when',
        penalty: 10,
        suggestion: 'Describe esta parte con más detalle.',
      },
    ],
  },
];

const run = (results: Partial<AnalysisResults> = {}, details = INPUT.details): AnalysisRun => ({
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
  results: { ...RESULTS, quality, ...results },
  input: { activities: INPUT.activities, details },
});

const settings = {
  extraAmbiguousTerms: ['ágil'],
  extraStopwords: [],
  schedule: { enabled: true, cron: '0 3 * * *', timezone: 'America/Guayaquil' },
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

function renderDashboard(handlers: Record<string, Handler | Handler[]> = {}) {
  const api = mockApi({
    'GET /api/config': () => json(200, { flags: { dashboard: true } }),
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
    [`GET ${SETTINGS}`]: () => json(200, settings),
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

async function open(name: string | RegExp) {
  const region = await screen.findByRole('region', { name: 'Análisis de texto' });
  await userEvent.click(await within(region).findByRole('tab', { name }));
  return within(region).getByRole('tabpanel');
}

describe('calidad de los requisitos', () => {
  it('ordena por puntaje (menor primero) y explica cada problema', async () => {
    renderDashboard();
    const panel = await open('Calidad');
    expect(within(panel).getByText('1 de 2 detalles tienen algo que mejorar.')).toBeInTheDocument();
    const items = within(within(panel).getByRole('list', { name: 'Detalles por calidad' }))
      .getAllByRole('listitem')
      .filter((item) => item.textContent?.startsWith('Puntaje'));
    expect(items.map((item) => item.textContent?.slice(0, 20))).toEqual([
      'Puntaje 60 de 100 · ',
      'Puntaje 100 de 100 ·',
    ]);
    const worst = items[0]!;
    expect(worst).toHaveTextContent(
      'Término ambiguo «rápido» (Entonces): Hazlo medible: indica una cifra, un tiempo o un criterio comprobable.',
    );
    expect(worst).toHaveTextContent('No es medible (Entonces)');
    expect(worst).toHaveTextContent(
      'Demasiado breve (Cuando): Describe esta parte con más detalle.',
    );
    expect(
      within(worst).getByRole('link', { name: 'Ir al diagrama para corregirlo' }),
    ).toHaveAttribute('href', `/proyectos/p1/diagramas/${B.diagramId}`);

    await userEvent.click(
      within(panel).getByRole('button', { name: 'Ordenar por puntaje: menor primero' }),
    );
    expect(
      within(panel).getByRole('button', { name: 'Ordenar por puntaje: mayor primero' }),
    ).toBeInTheDocument();
    const reordered = within(within(panel).getByRole('list', { name: 'Detalles por calidad' }))
      .getAllByRole('listitem')
      .filter((item) => item.textContent?.startsWith('Puntaje'));
    expect(reordered[0]).toHaveTextContent('Puntaje 100 de 100');
  });

  it('resalta el término ambiguo dentro del texto, también flexionado, sin interpretar HTML', async () => {
    const details = [A, { ...B, then: `la respuesta es rápida ${XSS}` }];
    renderDashboard({ [`GET ${LATEST}`]: () => json(200, run({}, details)) });
    const panel = await open('Calidad');
    const marks = [...panel.querySelectorAll('mark')].map((mark) => mark.textContent);
    expect(marks).toEqual(['rápida']);
    expect(within(panel).getByText(new RegExp(XSS.replace(/[()]/g, '\\$&')))).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('permite guardar los términos propios del proyecto', async () => {
    const api = renderDashboard({
      [`PUT ${SETTINGS}`]: () =>
        json(200, {
          ...settings,
          extraAmbiguousTerms: ['ágil', 'bonito'],
          extraStopwords: ['tienda'],
        }),
    });
    const panel = await open('Calidad');
    await userEvent.click(within(panel).getByText('Términos propios del proyecto'));
    const ambiguous = within(panel).getByLabelText('Términos ambiguos (uno por línea)');
    await waitFor(() => expect(ambiguous).toHaveValue('ágil'));
    await userEvent.type(ambiguous, '\nbonito');
    await userEvent.type(
      within(panel).getByLabelText('Palabras que el análisis debe ignorar (una por línea)'),
      'tienda',
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Guardar términos' }));
    expect(
      await within(panel).findByText('Guardado. Se aplicará en el próximo análisis.'),
    ).toBeInTheDocument();
    expect(api.requests.find((r) => r.method === 'PUT')?.body).toEqual({
      ...settings,
      extraAmbiguousTerms: ['ágil', 'bonito'],
      extraStopwords: ['tienda'],
    });
  });

  it('permite programar el análisis nocturno (desactivado por defecto)', async () => {
    const off = { ...settings.schedule, enabled: false };
    const api = renderDashboard({
      [`GET ${SETTINGS}`]: () => json(200, { ...settings, schedule: off }),
      [`PUT ${SETTINGS}`]: () =>
        json(200, { ...settings, schedule: { ...off, enabled: true, cron: '30 2 * * *' } }),
    });
    const region = await screen.findByRole('region', { name: 'Análisis de texto' });
    await userEvent.click(within(region).getByRole('button', { name: 'Análisis automático' }));
    const enabled = await within(region).findByLabelText('Analizar cada noche si hay cambios');
    const time = within(region).getByLabelText('Hora');
    await waitFor(() => expect(enabled).toBeEnabled());
    expect(enabled).not.toBeChecked();
    expect(time).toBeDisabled();
    expect(time).toHaveValue('03:00');
    expect(within(region).getByText('(America/Guayaquil)')).toBeInTheDocument();
    await userEvent.click(enabled);
    await userEvent.clear(time);
    await userEvent.type(time, '02:30');
    await userEvent.click(within(region).getByRole('button', { name: 'Guardar programación' }));
    expect(
      await within(region).findByText(
        'Guardado. El análisis se ejecutará cada noche si hay cambios.',
      ),
    ).toBeInTheDocument();
    expect(api.requests.find((r) => r.method === 'PUT')?.body).toEqual({
      ...settings,
      schedule: { enabled: true, cron: '30 2 * * *', timezone: 'America/Guayaquil' },
    });
  });

  it('un error al guardar muestra el motivo', async () => {
    renderDashboard({
      [`PUT ${SETTINGS}`]: () =>
        json(400, {
          code: 'VALIDATION_ERROR',
          message: 'Revisa los datos del formulario.',
          fields: { extraAmbiguousTerms: 'Como máximo 100 términos ambiguos.' },
        }),
    });
    const panel = await open('Calidad');
    await userEvent.click(within(panel).getByText('Términos propios del proyecto'));
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Guardar términos' })).toBeEnabled(),
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Guardar términos' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Como máximo 100 términos ambiguos.',
    );
  });
});

describe('posibles duplicados', () => {
  it('muestra cada par con su similitud; confirmar envía cuál se conserva y el par desaparece', async () => {
    const api = renderDashboard({
      [`GET ${LATEST}`]: [() => json(200, run()), () => json(200, run({ duplicates: [] }))],
      [`POST ${DECISIONS}`]: () =>
        json(201, {
          id: 'x',
          pair: [A.id, B.id],
          decision: 'confirmed',
          decidedAt: '2026-10-02T10:02:00.000Z',
        }),
    });
    const panel = await open(/^Duplicados \(1\)$/);
    expect(
      within(panel).getByText(
        /1 par de requisitos parece decir lo mismo\. Nada cambia hasta que lo confirmes\./,
      ),
    ).toBeInTheDocument();
    const card = within(panel).getByRole('listitem', { name: 'Posible duplicado' });
    expect(card).toHaveTextContent('Similitud: 93 %');
    const options = within(card).getAllByRole('radio');
    expect(options[0]).toBeChecked();
    await userEvent.click(options[1]!);
    await userEvent.click(within(card).getByRole('button', { name: 'Confirmar duplicado' }));
    await waitFor(() =>
      expect(api.requests.find((r) => r.method === 'POST')?.body).toEqual({
        pair: [A.id, B.id],
        decision: 'confirmed',
        keep: B.id,
        similarity: 0.93,
      }),
    );
    expect(
      await screen.findByText('No hay posibles duplicados pendientes de revisar.'),
    ).toBeInTheDocument();
  });

  it('rechazar no indica cuál conservar', async () => {
    const api = renderDashboard({
      [`POST ${DECISIONS}`]: () =>
        json(201, {
          id: 'x',
          pair: [A.id, B.id],
          decision: 'rejected',
          decidedAt: '2026-10-02T10:02:00.000Z',
        }),
    });
    const panel = await open(/^Duplicados/);
    await userEvent.click(within(panel).getByRole('button', { name: 'No son duplicados' }));
    await waitFor(() =>
      expect(api.requests.find((r) => r.method === 'POST')?.body).toEqual({
        pair: [A.id, B.id],
        decision: 'rejected',
        similarity: 0.93,
      }),
    );
  });

  it('un error de la API se muestra en el par', async () => {
    renderDashboard({
      [`POST ${DECISIONS}`]: () =>
        json(409, {
          code: 'PROJECT_NOT_OPEN',
          message: 'Solo se pueden marcar duplicados mientras el proyecto está abierto.',
        }),
    });
    const panel = await open(/^Duplicados/);
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirmar duplicado' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Solo se pueden marcar duplicados mientras el proyecto está abierto.',
    );
  });
});
