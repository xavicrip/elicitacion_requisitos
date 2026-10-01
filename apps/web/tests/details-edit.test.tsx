import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { json } from './helpers/api';
import {
  detail,
  DETAILS_URL,
  renderWorkspace,
  selectActivity,
  useDetailsTestSession,
} from './helpers/details';

useDetailsTestSession();

const mine = detail({
  author: { id: 'u1', name: 'Marta' },
  permissions: { canEdit: true, canDelete: true, canVote: false, canModerate: false },
});

/** Abre la edición del detalle propio y devuelve el panel y el formulario de edición. */
async function openEdit() {
  const panel = await selectActivity();
  await userEvent.click(await within(panel).findByRole('button', { name: 'Editar' }));
  return { panel, form: within(panel).getByRole('form', { name: 'Editar requisito' }) };
}

describe('editar un detalle propio (US2)', () => {
  it('guarda los cambios con If-Match y vuelve a cargar la lista', async () => {
    const api = renderWorkspace({
      [DETAILS_URL]: [
        () => json(200, [mine]),
        () => json(200, [{ ...mine, then: 'responde en 3 s', rev: 1 }]),
      ],
      'PATCH /api/details/x1': () => json(200, { ...mine, then: 'responde en 3 s', rev: 1 }),
    });
    const { panel, form } = await openEdit();
    const field = within(form).getByLabelText('Entonces (resultado)');
    expect(field).toHaveValue('el sistema confirma el pago');
    await userEvent.clear(field);
    await userEvent.type(field, 'responde en 3 s');
    await userEvent.click(within(panel).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(within(panel).getByRole('article')).toHaveTextContent('responde en 3 s'),
    );
    const patch = api.requests.find((request) => request.method === 'PATCH');
    expect(patch).toMatchObject({ url: '/api/details/x1', ifMatch: '"0"' });
    expect(patch?.body).toMatchObject({ then: 'responde en 3 s', tags: ['pagos'] });
    expect(within(panel).queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
  });

  it('en los detalles de otras personas no hay editar ni eliminar', async () => {
    renderWorkspace();
    const panel = await selectActivity();
    await within(panel).findByRole('article');
    expect(within(panel).queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Eliminar' })).toBeNull();
  });
});

describe('conflicto de edición (US2 escenario 4, FR-007)', () => {
  const theirs = { ...mine, then: 'la versión que guardó Ana', rev: 1 };

  it('muestra ambas versiones y "Conservar lo mío" reenvía con el rev nuevo', async () => {
    const api = renderWorkspace({
      [DETAILS_URL]: () => json(200, [mine]),
      'PATCH /api/details/x1': [
        () => json(409, theirs),
        () => json(200, { ...theirs, then: 'mi versión del resultado', rev: 2 }),
      ],
    });
    const { form } = await openEdit();
    const field = within(form).getByLabelText('Entonces (resultado)');
    await userEvent.clear(field);
    await userEvent.type(field, 'mi versión del resultado');
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Otra persona modificó este requisito',
    });
    expect(within(dialog).getByText('Entonces')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('mi versión del resultado');
    expect(dialog).toHaveTextContent('la versión que guardó Ana');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Conservar lo mío' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const patches = api.requests.filter((request) => request.method === 'PATCH');
    expect(patches.map((request) => request.ifMatch)).toEqual(['"0"', '"1"']);
    expect(patches[1]?.body).toMatchObject({ then: 'mi versión del resultado' });
  });

  it('"Usar la versión actual" descarta mis cambios sin volver a enviar', async () => {
    const api = renderWorkspace({
      [DETAILS_URL]: [() => json(200, [mine]), () => json(200, [theirs])],
      'PATCH /api/details/x1': () => json(409, theirs),
    });
    const { panel, form } = await openEdit();
    await userEvent.type(within(form).getByLabelText('Entonces (resultado)'), ' y algo más');
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Otra persona modificó este requisito',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usar la versión actual' }));

    await waitFor(() =>
      expect(within(panel).getByRole('article')).toHaveTextContent('la versión que guardó Ana'),
    );
    expect(api.requests.filter((request) => request.method === 'PATCH')).toHaveLength(1);
    expect(within(panel).queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
  });
});

describe('historial (FR-006)', () => {
  it('muestra las versiones anteriores con quién y cuándo', async () => {
    renderWorkspace({
      'GET /api/details/x1/history': () =>
        json(200, [
          {
            rev: 0,
            change: 'edit',
            editedBy: { id: 'u2', name: 'Luis' },
            editedAt: '2026-10-01T11:00:00.000Z',
            snapshot: { ...detail(), then: 'la primera versión del resultado' },
          },
        ]),
    });
    const panel = await selectActivity();
    await userEvent.click(await within(panel).findByRole('button', { name: 'Historial' }));
    const history = await screen.findByRole('dialog', { name: 'Historial del requisito' });
    expect(await within(history).findByText(/Luis/)).toBeInTheDocument();
    expect(history).toHaveTextContent('1/10/2026');
    expect(history).toHaveTextContent('la primera versión del resultado');
  });
});

describe('eliminar (US2 escenario 3)', () => {
  it('pide confirmación indicando los votos y comentarios que se borran', async () => {
    const withActivity = { ...mine, voteCount: 2, commentCount: 1 };
    const api = renderWorkspace({
      [DETAILS_URL]: [() => json(200, [withActivity]), () => json(200, [])],
      'DELETE /api/details/x1': () => new Response(null, { status: 204 }),
    });
    const panel = await selectActivity();
    await userEvent.click(await within(panel).findByRole('button', { name: 'Eliminar' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('2 voto(s) y 1 comentario(s)');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Eliminar requisito' }));

    await waitFor(() => expect(within(panel).queryByRole('article')).toBeNull());
    expect(api.requests.some((request) => request.method === 'DELETE')).toBe(true);
  });
});
