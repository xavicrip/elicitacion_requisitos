import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { json, mockApi } from './helpers/api';
import {
  activity,
  detail,
  DETAILS_URL,
  KEY,
  project,
  renderWorkspace,
  selectActivity,
  useDetailsTestSession,
  version,
} from './helpers/details';

useDetailsTestSession();

const asAdmin = { 'GET /api/projects/p1': () => json(200, project({ myRole: 'admin' })) };
const moderable = (overrides: Parameters<typeof detail>[0] = {}) =>
  detail({
    permissions: { canEdit: true, canDelete: true, canVote: true, canModerate: true },
    ...overrides,
  });

describe('moderar (US5, FR-010)', () => {
  it('el Administrador valida un detalle pendiente', async () => {
    const api = renderWorkspace({
      ...asAdmin,
      [DETAILS_URL]: () => json(200, [moderable()]),
      'POST /api/details/x1/status': () => json(200, moderable({ status: 'validated' })),
    });
    const panel = await selectActivity();
    await userEvent.click(await within(panel).findByRole('button', { name: 'Validar' }));
    await waitFor(() =>
      expect(api.requests.find((r) => r.url === '/api/details/x1/status')?.body).toEqual({
        status: 'validated',
      }),
    );
  });

  it('marca un detalle como duplicado eligiendo el original', async () => {
    const api = renderWorkspace({
      ...asAdmin,
      [DETAILS_URL]: () =>
        json(200, [moderable(), moderable({ id: 'x2', then: 'muestra el pago confirmado' })]),
      'POST /api/details/x2/status': () => json(200, moderable({ id: 'x2', status: 'duplicate' })),
    });
    const panel = await selectActivity();
    const second = (await within(panel).findAllByRole('article'))[1]!;
    await userEvent.click(within(second).getByRole('button', { name: 'Marcar como duplicado' }));
    await userEvent.selectOptions(
      within(second).getByLabelText('Original'),
      'Cuando paga con tarjeta → Entonces el sistema confirma el pago',
    );
    await userEvent.click(within(second).getByRole('button', { name: 'Confirmar duplicado' }));
    await waitFor(() =>
      expect(api.requests.find((r) => r.url === '/api/details/x2/status')?.body).toEqual({
        status: 'duplicate',
        duplicateOf: 'x1',
      }),
    );
  });

  it('descarta un detalle con motivo', async () => {
    const api = renderWorkspace({
      ...asAdmin,
      [DETAILS_URL]: () => json(200, [moderable()]),
      'POST /api/details/x1/status': () => json(200, moderable({ status: 'discarded' })),
    });
    const panel = await selectActivity();
    await userEvent.click(await within(panel).findByRole('button', { name: 'Descartar' }));
    await userEvent.type(within(panel).getByLabelText('Motivo del descarte'), 'Fuera de alcance');
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirmar descarte' }));
    await waitFor(() =>
      expect(api.requests.find((r) => r.url === '/api/details/x1/status')?.body).toEqual({
        status: 'discarded',
        discardReason: 'Fuera de alcance',
      }),
    );
  });

  it('un Participante no ve las acciones de moderación', async () => {
    renderWorkspace();
    const panel = await selectActivity();
    await within(panel).findByRole('article');
    expect(within(panel).queryByRole('button', { name: 'Validar' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Descartar' })).toBeNull();
  });
});

describe('cómo se ven los detalles moderados', () => {
  it('un duplicado aparece atenuado y enlaza al original; un descartado muestra el motivo', async () => {
    renderWorkspace({
      [DETAILS_URL]: () =>
        json(200, [
          detail(),
          detail({ id: 'x2', status: 'duplicate', duplicateOf: 'x1' }),
          detail({ id: 'x3', status: 'discarded', discardReason: 'Fuera de alcance' }),
        ]),
    });
    const panel = await selectActivity();
    const [, duplicate, discarded] = await within(panel).findAllByRole('article');
    expect(duplicate).toHaveClass('opacity-60');
    expect(within(duplicate!).getByRole('link', { name: 'Ver el original' })).toHaveAttribute(
      'href',
      '#detail-x1',
    );
    expect(discarded).toHaveTextContent('Motivo del descarte: Fuera de alcance');
  });
});

describe('filtros y orden del panel (FR-012)', () => {
  it('filtra por estado, tipo, prioridad y etiqueta y ordena por fecha', async () => {
    const api = renderWorkspace();
    const panel = await selectActivity();
    await within(panel).findByRole('article');
    await userEvent.selectOptions(within(panel).getByLabelText('Estado'), 'Validado');
    await userEvent.selectOptions(within(panel).getByLabelText('Tipo de requisito'), 'Funcional');
    await userEvent.selectOptions(
      within(panel).getByLabelText('Prioridad del requisito'),
      'Must (imprescindible)',
    );
    await userEvent.selectOptions(within(panel).getByLabelText('Etiqueta'), 'pagos');
    await userEvent.selectOptions(within(panel).getByLabelText('Orden'), 'Más recientes');
    await waitFor(() =>
      expect(api.requests.map((r) => r.url)).toContain(
        `/api/diagrams/d1/activities/${KEY}/details?sort=recent&status=validated&type=functional&priority=must&tag=pagos`,
      ),
    );
  });
});

describe('requisitos huérfanos (edge case de la spec)', () => {
  it('el Administrador los reasigna a una actividad publicada', async () => {
    const api = mockApi({
      'GET /api/config': () =>
        json(200, { flags: { accounts: true, diagrams: true, details: true } }),
      'GET /api/projects/p1': () => json(200, project({ myRole: 'admin' })),
      'GET /api/projects/p1/details/orphans': [
        () => json(200, [detail({ activityKey: 'perdida' })]),
        () => json(200, []),
      ],
      'GET /api/projects/p1/diagrams': () =>
        json(200, [{ id: 'd1', name: 'Proceso de compra', order: 0, publishedVersionId: 'v1' }]),
      'GET /api/diagram-versions/v1': () => json(200, version('v1', 1, 'published')),
      'POST /api/details/x1/reassign': () => json(200, detail()),
    });
    render(
      <AppProviders>
        <RouterProvider
          router={createMemoryRouter(routes, {
            initialEntries: ['/proyectos/p1/requisitos-huerfanos'],
          })}
        />
      </AppProviders>,
    );
    const item = await screen.findByRole('article');
    expect(item).toHaveTextContent('el sistema confirma el pago');
    await within(item).findByRole('option', { name: 'Proceso de compra' });
    await userEvent.selectOptions(within(item).getByLabelText('Diagrama'), 'Proceso de compra');
    await userEvent.selectOptions(await within(item).findByLabelText('Actividad'), activity.label);
    await userEvent.click(within(item).getByRole('button', { name: 'Reasignar' }));
    await waitFor(() =>
      expect(api.requests.find((r) => r.method === 'POST')?.body).toEqual({
        diagramId: 'd1',
        activityKey: KEY,
      }),
    );
    expect(await screen.findByText('No hay requisitos sin actividad.')).toBeInTheDocument();
  });
});
