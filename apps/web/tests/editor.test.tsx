import type { Activity, VersionWithActivities } from '@reqcanvas/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagramKeys } from '../src/features/diagrams/api';
import { ActivityForm } from '../src/features/diagrams/editor/ActivityForm';
import { AutosaveProvider } from '../src/features/diagrams/editor/useAutosave';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi, type Handler } from './helpers/api';

const activity = (overrides: Partial<Activity>): Activity => ({
  id: 'a1',
  key: '11111111-1111-4111-8111-111111111111',
  rev: 0,
  source: 'manual',
  label: 'Validar pago',
  type: 'action',
  bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
  next: [],
  ...overrides,
});
const a1 = activity({});
const a2 = activity({
  id: 'a2',
  key: '22222222-2222-4222-8222-222222222222',
  label: 'Emitir factura',
});
const version: VersionWithActivities = {
  id: 'v1',
  diagramId: 'd1',
  number: 1,
  status: 'draft',
  image: { displayUrl: '/api/x', thumbUrl: '/api/y', width: 900, height: 1200 },
  publishedAt: null,
  activities: [a1, a2],
};

let queryClient: QueryClient;
const onDeleted = vi.fn();

beforeEach(() => {
  useAuthStore.getState().setSession({
    accessToken: 'token-1',
    expiresIn: 900,
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(diagramKeys.version('v1'), version);
  onDeleted.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

function renderForm(handlers: Record<string, Handler | Handler[]>) {
  const api = mockApi(handlers);
  render(
    <QueryClientProvider client={queryClient}>
      <AutosaveProvider versionId="v1">
        <ActivityForm versionId="v1" activityKey={a1.key} onDeleted={onDeleted} />
      </AutosaveProvider>
    </QueryClientProvider>,
  );
  const patches = () => api.requests.filter((request) => request.method === 'PATCH');
  return { api, patches };
}

const saved =
  (patch: Partial<Activity>, rev = 1) =>
  (body: unknown) =>
    json(200, { ...a1, ...patch, ...(body as object), rev });

describe('useAutosave (FR-006)', () => {
  it('agrupa los cambios en un solo PATCH tras 500 ms, con If-Match', async () => {
    const { patches } = renderForm({ 'PATCH /api/activities/a1': saved({}) });
    const name = screen.getByLabelText('Nombre');
    await userEvent.clear(name);
    await userEvent.type(name, 'Validar el pago');
    expect(patches()).toHaveLength(0);

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({
      url: '/api/activities/a1',
      body: { label: 'Validar el pago' },
      ifMatch: '"0"',
    });
    expect(await screen.findByText('Guardado')).toBeInTheDocument();
  });

  it('muestra "Guardando…" desde el cambio hasta que el servidor lo confirma', async () => {
    renderForm({ 'PATCH /api/activities/a1': saved({ type: 'decision' }) });
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'Decisión');
    expect(screen.getByText('Guardando…')).toBeInTheDocument();
    expect(await screen.findByText('Guardado')).toBeInTheDocument();
  });

  it('el siguiente cambio usa el rev devuelto por el servidor', async () => {
    const { patches } = renderForm({
      'PATCH /api/activities/a1': [saved({ type: 'decision' }, 1), saved({ type: 'end' }, 2)],
    });
    const type = screen.getByLabelText('Tipo');
    await userEvent.selectOptions(type, 'Decisión');
    await waitFor(() => expect(patches()).toHaveLength(1));
    await screen.findByText('Guardado');
    await userEvent.selectOptions(type, 'Fin');
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches().map((request) => request.ifMatch)).toEqual(['"0"', '"1"']);
    expect(patches().map((request) => request.body)).toEqual([
      { type: 'decision' },
      { type: 'end' },
    ]);
  });

  it('un 409 recarga la actividad y avisa del conflicto', async () => {
    renderForm({
      'PATCH /api/activities/a1': () =>
        json(409, { ...a1, label: 'Cambiado por otra persona', rev: 3 }),
    });
    await userEvent.type(screen.getByLabelText('Nombre'), ' ya');
    expect(
      await screen.findByText('Otro administrador modificó esta actividad'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Nombre')).toHaveValue('Cambiado por otra persona'),
    );
    const cached = queryClient.getQueryData<VersionWithActivities>(diagramKeys.version('v1'));
    expect(cached?.activities[0]).toMatchObject({ rev: 3, label: 'Cambiado por otra persona' });
  });
});

describe('ActivityForm (FR-004, FR-005)', () => {
  it('un nombre vacío muestra el error y no se guarda', async () => {
    const { patches } = renderForm({});
    await userEvent.clear(screen.getByLabelText('Nombre'));
    expect(await screen.findByText('Escribe el nombre de la actividad.')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(patches()).toHaveLength(0);
  });

  it('conecta la actividad con otra (transiciones)', async () => {
    const { patches } = renderForm({ 'PATCH /api/activities/a1': saved({}) });
    const transitions = screen.getByRole('group', { name: 'Va a' });
    await userEvent.click(within(transitions).getByRole('checkbox', { name: 'Emitir factura' }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]!.body).toEqual({ next: [a2.key] });
    expect(within(transitions).queryByRole('checkbox', { name: 'Validar pago' })).toBeNull();
  });

  it('eliminar con requisitos pide confirmación con el conteo', async () => {
    const { api } = renderForm({
      'DELETE /api/activities/a1': () =>
        json(409, {
          code: 'HAS_DEPENDENTS',
          message: 'Esta actividad tiene 3 elemento(s) asociado(s).',
          detailCount: 3,
        }),
      'DELETE /api/activities/a1?confirm=true': () => new Response(null, { status: 204 }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar actividad' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('3');
    // Plan de la 004, ajuste 4: los requisitos no se borran; quedan para reasignarlos.
    expect(dialog).toHaveTextContent(
      'quedarán sin actividad al publicar esta versión y podrás reasignarlos',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar de todos modos' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(api.requests.map((request) => `${request.method} ${request.url}`)).toContain(
      'DELETE /api/activities/a1?confirm=true',
    );
    const cached = queryClient.getQueryData<VersionWithActivities>(diagramKeys.version('v1'));
    expect(cached?.activities.map((a) => a.id)).toEqual(['a2']);
  });

  it('eliminar sin dependientes no pide confirmación', async () => {
    renderForm({ 'DELETE /api/activities/a1': () => new Response(null, { status: 204 }) });
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar actividad' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
