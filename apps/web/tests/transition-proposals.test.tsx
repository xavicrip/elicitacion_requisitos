import type { ActivityProposal, TransitionProposal } from '@reqcanvas/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProposalReviewPanel } from '../src/features/detection/ProposalReviewPanel';
import { ProposalsLayer } from '../src/features/detection/ProposalsLayer';
import { imageToScreen } from '../src/features/diagrams/workspace/camera/zoom';
import { useWorkspaceStore } from '../src/features/diagrams/workspace/store';
import { useConnectionStore } from '../src/features/realtime/connection';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi, type Handler } from './helpers/api';

// US3 de la 006 (FR-004): flechas propuestas sobre el canvas y en el panel de revisión.

const PROPOSALS_URL = '/api/diagram-versions/v2/proposals';

const transition = (overrides: Partial<TransitionProposal> = {}): TransitionProposal => ({
  id: 't1',
  jobId: 'j1',
  versionId: 'v2',
  fromProposalId: 'p1',
  toProposalId: 'p2',
  confidence: 0.8,
  status: 'pending',
  from: { label: 'Validar pago', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, status: 'accepted' },
  to: { label: 'Emitir factura', bbox: { x: 0.1, y: 0.5, w: 0.2, h: 0.1 }, status: 'accepted' },
  ...overrides,
});
const pendingEnds = transition({
  id: 't2',
  from: { label: 'Emitir factura', bbox: { x: 0.1, y: 0.5, w: 0.2, h: 0.1 }, status: 'accepted' },
  to: { label: 'Enviar pedido', bbox: { x: 0.1, y: 0.8, w: 0.2, h: 0.1 }, status: 'pending' },
});
const enviar: ActivityProposal = {
  id: 'p3',
  jobId: 'j1',
  versionId: 'v2',
  bbox: { x: 0.1, y: 0.8, w: 0.2, h: 0.1 },
  type: 'action',
  label: 'Enviar pedido',
  confidence: 0.9,
  confidenceLevel: 'high',
  flags: [],
  status: 'pending',
  activityId: null,
};

beforeEach(() => {
  useAuthStore.getState().setSession({
    accessToken: 'token-1',
    expiresIn: 900,
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  });
  useConnectionStore.getState().reset();
  useWorkspaceStore.getState().reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

function renderPanel(
  lists: Array<{ activities: ActivityProposal[]; transitions: TransitionProposal[] }>,
  handlers: Record<string, Handler | Handler[]> = {},
) {
  const api = mockApi({
    [`GET ${PROPOSALS_URL}`]: lists.map((list) => () => json(200, list)),
    'GET /api/diagram-versions/v2/detections': () => json(404, { code: 'NOT_FOUND', message: 'x' }),
    'GET /api/diagram-versions/v2': () => json(200, {}),
    ...handlers,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<ProposalReviewPanel versionId="v2" socket={null} />, { wrapper });
  return api;
}

describe('flechas en el panel', () => {
  it('se listan con origen y destino; aceptar solo cuando las dos actividades están aceptadas', async () => {
    renderPanel([{ activities: [enviar], transitions: [transition(), pendingEnds] }]);
    expect(
      await screen.findByRole('heading', { name: 'Flechas propuestas (2)' }),
    ).toBeInTheDocument();
    const ready = screen.getByRole('listitem', { name: 'Flecha Validar pago → Emitir factura' });
    expect(within(ready).getByRole('button', { name: 'Aceptar' })).toBeEnabled();
    const waiting = screen.getByRole('listitem', { name: 'Flecha Emitir factura → Enviar pedido' });
    expect(
      within(waiting).getByText('Acepta antes las dos actividades que une.'),
    ).toBeInTheDocument();
    expect(within(waiting).getByRole('button', { name: 'Aceptar' })).toBeDisabled();
    expect(within(waiting).getByRole('button', { name: 'Descartar' })).toBeEnabled();
  });

  it('aceptar y descartar llaman a la API y la lista se actualiza', async () => {
    const api = renderPanel(
      [
        { activities: [], transitions: [transition(), pendingEnds] },
        { activities: [], transitions: [pendingEnds] },
        { activities: [], transitions: [] },
      ],
      {
        'POST /api/transition-proposals/t1/accept': () => json(200, { accepted: true }),
        'POST /api/transition-proposals/t2/discard': () => new Response(null, { status: 204 }),
      },
    );
    const ready = await screen.findByRole('listitem', {
      name: 'Flecha Validar pago → Emitir factura',
    });
    await userEvent.click(within(ready).getByRole('button', { name: 'Aceptar' }));
    const waiting = await screen.findByRole('listitem', {
      name: 'Flecha Emitir factura → Enviar pedido',
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('listitem', { name: 'Flecha Validar pago → Emitir factura' }),
      ).toBeNull(),
    );
    await userEvent.click(within(waiting).getByRole('button', { name: 'Descartar' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Propuestas pendientes' })).toBeNull(),
    );
    expect(api.requests.map((r) => `${r.method} ${r.url}`)).toEqual(
      expect.arrayContaining([
        'POST /api/transition-proposals/t1/accept',
        'POST /api/transition-proposals/t2/discard',
      ]),
    );
  });
});

describe('flechas en la capa', () => {
  it('se dibujan discontinuas entre los centros de sus extremos', () => {
    const camera = { zoom: 1, center: { x: 450, y: 600 } };
    const viewport = { width: 900, height: 700 };
    act(() => {
      useWorkspaceStore.getState().setViewport(viewport);
      useWorkspaceStore.getState().setCamera(camera);
    });
    render(
      <ProposalsLayer
        image={{ width: 900, height: 1200 }}
        proposals={[]}
        transitions={[transition()]}
      />,
    );
    const line = screen.getByTestId('proposed-transition');
    const from = imageToScreen({ x: 180, y: 180 }, camera, viewport);
    const to = imageToScreen({ x: 180, y: 660 }, camera, viewport);
    expect(line).toHaveAttribute('x1', String(from.x));
    expect(line).toHaveAttribute('y1', String(from.y));
    expect(line).toHaveAttribute('y2', String(to.y));
    expect(line).toHaveAttribute('stroke-dasharray', '6 4');
    expect(screen.getByText('Flecha propuesta: Validar pago → Emitir factura')).toBeInTheDocument();
  });
});
