import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { json } from './helpers/api';
import {
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

describe('panel de detalles (US1, FR-001)', () => {
  it('sin actividad seleccionada, invita a seleccionar una', async () => {
    renderWorkspace();
    const panel = await screen.findByRole('complementary', { name: 'Requisitos' });
    expect(panel).toHaveTextContent('Selecciona una actividad');
  });

  it('al seleccionar una actividad muestra sus detalles con autor y fecha', async () => {
    renderWorkspace();
    const panel = await selectActivity();
    expect(
      within(panel).getByRole('heading', { name: 'Requisitos de «Validar pago»' }),
    ).toBeInTheDocument();
    const card = await within(panel).findByRole('article');
    expect(card).toHaveTextContent('Dado el cliente tiene productos en el carrito');
    expect(card).toHaveTextContent('Cuando paga con tarjeta');
    expect(card).toHaveTextContent('Entonces el sistema confirma el pago');
    expect(card).toHaveTextContent('No funcional');
    expect(card).toHaveTextContent('Luis');
    expect(card).toHaveTextContent('1/10/2026');
    expect(card).toHaveTextContent('#pagos');
  });

  it('el texto con HTML se muestra literal', async () => {
    renderWorkspace({
      [DETAILS_URL]: () => json(200, [detail({ given: '<b>negrita</b> texto' })]),
    });
    const panel = await selectActivity();
    expect(await within(panel).findByText(/<b>negrita<\/b> texto/)).toBeInTheDocument();
    expect(panel.querySelector('b')).toBeNull();
  });

  it('registra un detalle y vuelve a cargar la lista', async () => {
    const api = renderWorkspace({
      [DETAILS_URL]: [() => json(200, []), () => json(200, [detail()])],
      [`POST /api/diagrams/d1/activities/${KEY}/details`]: () => json(201, detail()),
    });
    const panel = await selectActivity();
    await userEvent.type(
      within(panel).getByLabelText('Dado (contexto)'),
      'el cliente tiene productos en el carrito',
    );
    await userEvent.type(within(panel).getByLabelText('Cuando (acción)'), 'paga con tarjeta');
    await userEvent.type(
      within(panel).getByLabelText('Entonces (resultado)'),
      'el sistema confirma el pago',
    );
    await userEvent.selectOptions(within(panel).getByLabelText('Tipo'), 'No funcional');
    await userEvent.selectOptions(
      within(panel).getByLabelText('Prioridad'),
      'Must (imprescindible)',
    );
    await userEvent.type(within(panel).getByLabelText('Tu rol'), 'Cajero');
    await userEvent.type(
      within(panel).getByLabelText('Etiquetas (separadas por comas)'),
      'Pagos, tarjeta',
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Guardar requisito' }));

    await waitFor(() => expect(within(panel).getByRole('article')).toBeInTheDocument());
    const post = api.requests.find((request) => request.method === 'POST');
    expect(post?.body).toEqual({
      given: 'el cliente tiene productos en el carrito',
      when: 'paga con tarjeta',
      then: 'el sistema confirma el pago',
      type: 'non_functional',
      priority: 'must',
      authorRole: 'Cajero',
      tags: ['Pagos', 'tarjeta'],
    });
    expect(within(panel).getByLabelText('Dado (contexto)')).toHaveValue('');
  });

  it('indica qué campo falta y no envía nada (US1 escenario 2)', async () => {
    const api = renderWorkspace();
    const panel = await selectActivity();
    await userEvent.type(within(panel).getByLabelText('Dado (contexto)'), 'el cliente compra');
    await userEvent.click(within(panel).getByRole('button', { name: 'Guardar requisito' }));
    expect(
      await within(panel).findByText('Escribe la acción (Cuando): al menos 5 caracteres.'),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText('Escribe el resultado (Entonces): al menos 5 caracteres.'),
    ).toBeInTheDocument();
    expect(api.requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('el contador de caracteres avisa cerca del límite de 1 000', async () => {
    renderWorkspace();
    const panel = await selectActivity();
    const field = within(panel).getByLabelText('Entonces (resultado)');
    await userEvent.click(field);
    await userEvent.paste('x'.repeat(950));
    expect(within(panel).getByText('950/1000')).toBeInTheDocument();
  });

  it('sugiere roles y etiquetas ya usados en el proyecto (FR-003)', async () => {
    renderWorkspace();
    const panel = await selectActivity();
    await waitFor(() =>
      expect(panel.querySelector('datalist option[value="Cajero"]')).not.toBeNull(),
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Añadir la etiqueta legal' }));
    expect(within(panel).getByLabelText('Etiquetas (separadas por comas)')).toHaveValue('legal');
  });

  it('en un proyecto cerrado se ven los detalles pero no el formulario (US1 escenario 4)', async () => {
    renderWorkspace({ 'GET /api/projects/p1': () => json(200, project({ status: 'closed' })) });
    const panel = await selectActivity();
    expect(await within(panel).findByRole('article')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Guardar requisito' })).toBeNull();
    expect(panel).toHaveTextContent('El proyecto está cerrado');
  });
});

describe('Administrador con borrador y versión publicada (plan, ajuste 8)', () => {
  it('cambia entre Borrador y Publicada para ver los requisitos', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderWorkspace({
      'GET /api/projects/p1': () => json(200, project({ myRole: 'admin' })),
      'GET /api/projects/p1/diagrams': () =>
        json(200, [
          {
            id: 'd1',
            name: 'Proceso de compra',
            order: 0,
            publishedVersionId: 'v1',
            draftVersionId: 'v2',
          },
        ]),
      'GET /api/diagram-versions/v2': () => json(200, version('v2', 2, 'draft')),
    });
    expect(await screen.findByText('Versión 2 · Borrador')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Requisitos' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Ver la versión publicada' }));
    expect(await screen.findByText('Versión 1 · Publicado')).toBeInTheDocument();
    expect(await screen.findByRole('complementary', { name: 'Requisitos' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Editar el borrador' }));
    expect(await screen.findByText('Versión 2 · Borrador')).toBeInTheDocument();
  });
});
