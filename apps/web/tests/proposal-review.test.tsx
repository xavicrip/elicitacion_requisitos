import type { ActivityProposal } from '@reqcanvas/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProposalReviewPanel,
  acceptableInBulk,
} from '../src/features/detection/ProposalReviewPanel';
import { diagramKeys } from '../src/features/diagrams/api';
import { useConnectionStore } from '../src/features/realtime/connection';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi, type Handler } from './helpers/api';

// US2 de la 006 (FR-005, FR-006, FR-008): revisar las propuestas en el panel del editor.

const PROPOSALS_URL = '/api/diagram-versions/v2/proposals';
const JOB_URL = '/api/diagram-versions/v2/detections';

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
const validar = proposal();
const emitir = proposal({
  id: 'p2',
  label: 'Emitir factura',
  confidence: 0.62,
  confidenceLevel: 'medium',
});
const duplicada = proposal({ id: 'p3', label: 'Enviar pedido', flags: ['possible_duplicate'] });
const sinNombre = proposal({
  id: 'p4',
  label: '',
  confidence: 0.4,
  confidenceLevel: 'low',
  flags: ['empty_label'],
});

/** Socket simulado: eventos del servidor a mano. */
function fakeSocket() {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  return {
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

let client: QueryClient;

beforeEach(() => {
  useAuthStore.getState().setSession({
    accessToken: 'token-1',
    expiresIn: 900,
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  });
  useConnectionStore.getState().reset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

function renderPanel(
  activities: ActivityProposal[] | ActivityProposal[][],
  handlers: Record<string, Handler | Handler[]> = {},
  socket = fakeSocket(),
) {
  const lists = Array.isArray(activities[0]) ? (activities as ActivityProposal[][]) : [activities];
  const api = mockApi({
    [`GET ${PROPOSALS_URL}`]: lists.map(
      (list) => () => json(200, { activities: list, transitions: [] }),
    ),
    [`GET ${JOB_URL}`]: () => json(404, { code: 'NOT_FOUND', message: 'x' }),
    'GET /api/diagram-versions/v2': () => json(200, {}),
    ...handlers,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<ProposalReviewPanel versionId="v2" socket={socket as never} />, { wrapper });
  return { api, socket };
}

const item = (name: string) => screen.findByRole('listitem', { name: `Propuesta ${name}` });

describe('panel de revisión', () => {
  it('lista las pendientes con su confianza y avisa de los posibles duplicados', async () => {
    renderPanel([validar, emitir, duplicada]);
    expect(
      await screen.findByRole('heading', { name: 'Propuestas pendientes (3)' }),
    ).toBeInTheDocument();
    expect(await item('Validar pago')).toHaveTextContent('Confianza alta');
    expect(await item('Emitir factura')).toHaveTextContent('Confianza media');
    expect(await item('Enviar pedido')).toHaveTextContent(
      'Posible duplicado de una actividad existente: no se acepta en bloque.',
    );
  });

  it('aceptar con el nombre corregido envía solo las correcciones y actualiza la lista y las actividades', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { api } = renderPanel([[validar, emitir], [validar]], {
      'POST /api/proposals/p2/accept': () => json(200, { id: 'a1' }),
    });
    const card = await item('Emitir factura');
    const name = within(card).getByLabelText('Nombre');
    await userEvent.clear(name);
    await userEvent.type(name, 'Emitir la factura');
    await userEvent.click(within(card).getByRole('button', { name: 'Aceptar' }));
    await waitFor(() =>
      expect(api.requests.find((r) => r.method === 'POST')?.body).toEqual({
        label: 'Emitir la factura',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('listitem', { name: 'Propuesta Emitir factura' })).toBeNull(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: diagramKeys.version('v2') });
  });

  it('cambiar el tipo también es una corrección', async () => {
    const { api } = renderPanel([validar], {
      'POST /api/proposals/p1/accept': () => json(200, { id: 'a1' }),
    });
    const card = await item('Validar pago');
    await userEvent.selectOptions(within(card).getByLabelText('Tipo'), 'decision');
    await userEvent.click(within(card).getByRole('button', { name: 'Aceptar' }));
    await waitFor(() =>
      expect(api.requests.find((r) => r.method === 'POST')?.body).toEqual({ type: 'decision' }),
    );
  });

  it('una acción sin nombre pide escribirlo antes de aceptar', async () => {
    renderPanel([sinNombre]);
    const card = await item('Sin nombre');
    expect(within(card).getByText('Escribe el nombre para aceptarla.')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Aceptar' })).toBeDisabled();
    await userEvent.type(within(card).getByLabelText('Nombre'), 'Confirmar envío');
    expect(within(card).getByRole('button', { name: 'Aceptar' })).toBeEnabled();
  });

  it('descartar llama a la API; un error se muestra en la propuesta', async () => {
    const { api } = renderPanel([validar], {
      'POST /api/proposals/p1/discard': () =>
        json(409, { code: 'PROPOSAL_NOT_PENDING', message: 'Esta propuesta ya se revisó.' }),
    });
    const card = await item('Validar pago');
    await userEvent.click(within(card).getByRole('button', { name: 'Descartar' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'Esta propuesta ya se revisó.',
    );
    expect(api.requests.some((r) => r.url === '/api/proposals/p1/discard')).toBe(true);
  });

  it('«Aceptar todas las de confianza alta» indica cuántas y excluye duplicados y acciones sin nombre', async () => {
    const { api } = renderPanel([[validar, emitir, duplicada, sinNombre], []], {
      'POST /api/diagram-versions/v2/proposals/accept-high': () => json(200, { accepted: 1 }),
    });
    const bulk = await screen.findByRole('button', {
      name: 'Aceptar todas las de confianza alta (1)',
    });
    await userEvent.click(bulk);
    await waitFor(() =>
      expect(api.requests.some((r) => r.url.endsWith('/proposals/accept-high'))).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Propuestas pendientes/ })).toBeNull(),
    );
  });

  it('sin propuestas de confianza alta, el botón queda deshabilitado', async () => {
    renderPanel([emitir]);
    expect(
      await screen.findByRole('button', { name: 'Aceptar todas las de confianza alta (0)' }),
    ).toBeDisabled();
  });

  it('proposal.reviewed de otra pestaña actualiza la lista', async () => {
    const { socket } = renderPanel([[validar, emitir], [emitir]]);
    await item('Validar pago');
    act(() =>
      socket.fire('proposal.reviewed', {
        versionId: 'v2',
        proposalId: 'p1',
        kind: 'activity',
        status: 'accepted',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('listitem', { name: 'Propuesta Validar pago' })).toBeNull(),
    );
  });

  it('sin pendientes no muestra nada', async () => {
    const { api } = renderPanel([]);
    await waitFor(() => expect(api.requests.some((r) => r.url === PROPOSALS_URL)).toBe(true));
    expect(screen.queryByRole('region', { name: 'Propuestas pendientes' })).toBeNull();
  });
});

describe('acceptableInBulk', () => {
  it('alta, sin duplicado y con nombre si es una acción', () => {
    expect(acceptableInBulk(validar)).toBe(true);
    expect(acceptableInBulk(emitir)).toBe(false);
    expect(acceptableInBulk(duplicada)).toBe(false);
    expect(acceptableInBulk(proposal({ label: '', type: 'start' }))).toBe(true);
    expect(acceptableInBulk(proposal({ label: '' }))).toBe(false);
  });
});
