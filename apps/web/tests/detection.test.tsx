import type { ActivityProposal, DetectionJob } from '@reqcanvas/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { DetectionPanel } from '../src/features/detection/DetectionPanel';
import { ProposalsLayer } from '../src/features/detection/ProposalsLayer';
import { POLL_MS } from '../src/features/detection/useDetection';
import { imageToScreen } from '../src/features/diagrams/workspace/camera/zoom';
import { useWorkspaceStore } from '../src/features/diagrams/workspace/store';
import { useConnectionStore } from '../src/features/realtime/connection';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi, type Handler } from './helpers/api';

// US1 de la 006 (FR-001, FR-002, FR-003; plan, ajustes 7 y 8): lanzar la detección, su progreso
// por el socket o consultando, el resultado y las propuestas sobre el canvas.

const JOB_URL = '/api/diagram-versions/v2/detections';
const PROPOSALS_URL = '/api/diagram-versions/v2/proposals';

const job = (overrides: Partial<DetectionJob> = {}): DetectionJob => ({
  id: 'j1',
  versionId: 'v2',
  status: 'pending',
  progress: { stage: 'download', pct: 0 },
  error: null,
  metrics: { proposed: 0, accepted: 0, edited: 0, discarded: 0, durationMs: null, llmUsed: false },
  createdAt: '2026-10-02T10:00:00.000Z',
  finishedAt: null,
  ...overrides,
});
const done = (proposed: number) =>
  job({
    status: 'done',
    progress: { stage: 'refine', pct: 100 },
    metrics: { ...job().metrics, proposed },
  });

const proposal = (overrides: Partial<ActivityProposal> = {}): ActivityProposal => ({
  id: 'p1',
  jobId: 'j1',
  versionId: 'v2',
  bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
  type: 'action',
  label: 'Validar pago',
  confidence: 0.91,
  confidenceLevel: 'high',
  flags: [],
  status: 'pending',
  activityId: null,
  ...overrides,
});

/** Socket simulado: eventos del servidor a mano. */
function fakeSocket() {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  return {
    emit: vi.fn(),
    on: (name: string, handler: (payload: unknown) => void) =>
      void handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    off: (name: string, handler: (payload: unknown) => void) =>
      void handlers.set(
        name,
        (handlers.get(name) ?? []).filter((h) => h !== handler),
      ),
    fire: (name: string, payload: unknown) => {
      for (const handler of handlers.get(name) ?? []) handler(payload);
    },
  };
}

const envelope = {
  projectId: 'p1',
  diagramId: 'd1',
  versionId: 'v2',
  jobId: 'j1',
  at: '',
  eventId: 'e',
};

beforeEach(() => {
  useAuthStore.getState().setSession({
    accessToken: 'token-1',
    expiresIn: 900,
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  });
  useWorkspaceStore.getState().reset();
  useConnectionStore.getState().reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

function renderPanel(handlers: Record<string, Handler | Handler[]>, socket = fakeSocket()) {
  const api = mockApi(handlers);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<DetectionPanel versionId="v2" socket={socket as never} />, { wrapper });
  return { api, socket };
}

describe('panel de la detección', () => {
  it('lanza la detección y muestra el progreso que llega por el socket', async () => {
    useConnectionStore.getState().setStatus('connected');
    const { api, socket } = renderPanel({
      [`GET ${JOB_URL}`]: [
        () => json(404, { code: 'NOT_FOUND', message: 'x' }),
        () => json(200, done(3)),
      ],
      [`POST ${JOB_URL}`]: () => json(202, job()),
      [`GET ${PROPOSALS_URL}`]: () => json(200, { activities: [], transitions: [] }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Detectar actividades' }));
    expect(api.requests.find((r) => r.method === 'POST')?.url).toBe(JOB_URL);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Detectando actividades… Descargando la imagen (0 %)',
    );
    expect(screen.getByRole('button', { name: 'Detectar actividades' })).toBeDisabled();

    act(() => socket.fire('detection.progress', { ...envelope, stage: 'ocr', pct: 55 }));
    // TanStack Query notifica los cambios de la caché de forma asíncrona.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Leyendo los textos (55 %)'),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Puedes seguir trabajando');

    act(() => socket.fire('detection.completed', { ...envelope, proposed: 3 }));
    expect(await screen.findByText(/Se propusieron 3 zonas/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Detectar actividades' })).toBeEnabled();
  });

  it('ignora los eventos de otra versión', async () => {
    useConnectionStore.getState().setStatus('connected');
    const { socket } = renderPanel({
      [`GET ${JOB_URL}`]: () => json(200, job({ status: 'running' })),
      [`GET ${PROPOSALS_URL}`]: () => json(200, { activities: [], transitions: [] }),
    });
    await screen.findByRole('status');
    act(() => {
      socket.fire('detection.progress', { ...envelope, versionId: 'otra', stage: 'ocr', pct: 90 });
      socket.fire('detection.progress', { ...envelope, stage: 'shapes', pct: 30 });
    });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('(30 %)'));
    expect(screen.getByRole('status')).not.toHaveTextContent('90 %');
  });

  it('sin socket conectado consulta el progreso cada 3 s mientras dura', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = renderPanel({
      [`GET ${JOB_URL}`]: [
        () => json(200, job({ status: 'running', progress: { stage: 'shapes', pct: 20 } })),
        () => json(200, done(0)),
      ],
      [`GET ${PROPOSALS_URL}`]: () => json(200, { activities: [], transitions: [] }),
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Buscando formas (20 %)');
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS + 100));
    expect(
      await screen.findByText('No se encontraron actividades; marca las zonas manualmente.'),
    ).toBeInTheDocument();
    expect(api.requests.filter((r) => r.url === JOB_URL)).toHaveLength(2);
  });

  it('un fallo muestra el mensaje y Reintentar', async () => {
    renderPanel({
      [`GET ${JOB_URL}`]: () =>
        json(
          200,
          job({
            status: 'failed',
            error: {
              code: 'TIMEOUT',
              message:
                'La detección tardó demasiado. Vuelve a intentarlo o marca las zonas manualmente.',
            },
          }),
        ),
      [`GET ${PROPOSALS_URL}`]: () => json(200, { activities: [], transitions: [] }),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('La detección tardó demasiado');
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled();
  });

  it('si la API rechaza el inicio, muestra su mensaje', async () => {
    renderPanel({
      [`GET ${JOB_URL}`]: () => json(404, { code: 'NOT_FOUND', message: 'x' }),
      [`POST ${JOB_URL}`]: () =>
        json(409, {
          code: 'DETECTION_IN_PROGRESS',
          message: 'Ya hay una detección en curso para esta versión.',
        }),
      [`GET ${PROPOSALS_URL}`]: () => json(200, { activities: [], transitions: [] }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Detectar actividades' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya hay una detección en curso para esta versión.',
    );
  });
});

describe('capa de propuestas', () => {
  it('dibuja cada propuesta en coordenadas de imagen con su confianza en texto', () => {
    const camera = { zoom: 0.5, center: { x: 450, y: 600 } };
    const viewport = { width: 800, height: 600 };
    act(() => {
      useWorkspaceStore.getState().setViewport(viewport);
      useWorkspaceStore.getState().setCamera(camera);
    });
    render(
      <ProposalsLayer
        image={{ width: 900, height: 1200 }}
        proposals={[
          proposal(),
          proposal({
            id: 'p2',
            label: '',
            confidence: 0.3,
            confidenceLevel: 'low',
            flags: ['empty_label'],
          }),
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAccessibleName('Propuesta: Validar pago · Acción · Confianza alta');
    expect(items[1]).toHaveAccessibleName('Propuesta: Sin nombre · Acción · Confianza baja');
    expect(within(items[0]!).getByText(/Validar pago/)).toHaveTextContent('●');
    const expected = imageToScreen({ x: 90, y: 240 }, camera, viewport);
    expect(items[0]).toHaveStyle({
      left: `${expected.x}px`,
      top: `${expected.y}px`,
      width: '135px',
    });
  });

  it('sin propuestas no dibuja nada', () => {
    const { container } = render(
      <ProposalsLayer image={{ width: 900, height: 1200 }} proposals={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('en el espacio de trabajo', () => {
  const project = (myRole: string) => ({
    id: 'p1',
    name: 'Tienda en línea',
    description: '',
    status: 'open',
    myRole,
    lastActivityAt: '2026-09-30T10:00:00.000Z',
    memberCount: 2,
    createdAt: '2026-09-30T09:00:00.000Z',
  });
  const version = {
    id: 'v2',
    diagramId: 'd1',
    number: 2,
    status: 'draft',
    image: { displayUrl: '/api/x', thumbUrl: '/api/y', width: 900, height: 1200 },
    publishedAt: null,
    activities: [],
  };

  function renderWorkspace() {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    mockApi({
      'GET /api/config': () => json(200, { flags: {} }),
      'GET /api/projects/p1': () => json(200, project('admin')),
      'GET /api/projects/p1/diagrams': () =>
        json(200, [
          {
            id: 'd1',
            name: 'Proceso de compra',
            order: 0,
            publishedVersionId: null,
            draftVersionId: 'v2',
            thumbUrl: '/api/y',
          },
        ]),
      'GET /api/diagram-versions/v2': () => json(200, version),
      [`GET ${JOB_URL}`]: () => json(404, { code: 'NOT_FOUND', message: 'x' }),
      [`GET ${PROPOSALS_URL}`]: () => json(200, { activities: [], transitions: [] }),
    });
    render(
      <AppProviders>
        <RouterProvider
          router={createMemoryRouter(routes, { initialEntries: ['/proyectos/p1/diagramas/d1'] })}
        />
      </AppProviders>,
    );
  }

  it('el Administrador ve "Detectar actividades" en el editor', async () => {
    renderWorkspace();
    expect(await screen.findByRole('button', { name: 'Detectar actividades' })).toBeInTheDocument();
    expect(useWorkspaceStore.getState().mode).toBe('edit');
  });
});
