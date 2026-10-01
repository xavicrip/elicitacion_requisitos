import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { json } from './helpers/api';
import {
  detail,
  DETAILS_URL,
  project,
  renderWorkspace,
  selectActivity,
  useDetailsTestSession,
} from './helpers/details';

useDetailsTestSession();

const comment = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  detailId: 'x1',
  text: '¿Aplica también a PayPal?',
  author: { id: 'u1', name: 'Marta' },
  createdAt: '2026-10-01T11:00:00.000Z',
  editedAt: null,
  permissions: { canEdit: true, canDelete: true },
  ...overrides,
});

describe('votar (US4, FR-008)', () => {
  it('actualiza el contador al instante y confirma con la API', async () => {
    let resolve: (response: Response) => void = () => {};
    const api = renderWorkspace({
      'PUT /api/details/x1/vote': () => new Promise<Response>((r) => (resolve = r)),
    });
    const panel = await selectActivity();
    const button = await within(panel).findByRole('button', { name: 'Votar' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    // Optimista: antes de que responda la API.
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByRole('article')).toHaveTextContent('3 voto(s)');
    resolve(json(200, { voteCount: 3, votedByMe: true }));
    await waitFor(() => expect(api.requests.some((r) => r.method === 'PUT')).toBe(true));
  });

  it('volver a pulsar retira el voto', async () => {
    const api = renderWorkspace({
      [DETAILS_URL]: () => json(200, [detail({ votedByMe: true, voteCount: 3 })]),
      'DELETE /api/details/x1/vote': () => json(200, { voteCount: 2, votedByMe: false }),
    });
    const panel = await selectActivity();
    const button = await within(panel).findByRole('button', { name: 'Votar' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button);
    await waitFor(() => expect(api.requests.some((r) => r.method === 'DELETE')).toBe(true));
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('si la API falla, vuelve atrás y lo explica', async () => {
    renderWorkspace({
      'PUT /api/details/x1/vote': () =>
        json(409, {
          code: 'VOTE_NOT_ALLOWED',
          message: 'Solo se votan requisitos pendientes o validados.',
        }),
    });
    const panel = await selectActivity();
    const button = await within(panel).findByRole('button', { name: 'Votar' });
    await userEvent.click(button);
    expect(
      await within(panel).findByText('Solo se votan requisitos pendientes o validados.'),
    ).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(within(panel).getByRole('article')).toHaveTextContent('2 voto(s)');
  });

  it('en los detalles propios el voto está deshabilitado', async () => {
    renderWorkspace({
      [DETAILS_URL]: () =>
        json(200, [
          detail({
            author: { id: 'u1', name: 'Marta' },
            permissions: { canEdit: true, canDelete: true, canVote: false, canModerate: false },
          }),
        ]),
    });
    const panel = await selectActivity();
    expect(await within(panel).findByRole('button', { name: 'Votar' })).toBeDisabled();
  });
});

describe('comentar (US4, FR-009)', () => {
  async function openComments(handlers: Parameters<typeof renderWorkspace>[0] = {}) {
    const api = renderWorkspace({
      [DETAILS_URL]: () => json(200, [detail({ commentCount: 1 })]),
      'GET /api/details/x1/comments': () => json(200, [comment()]),
      ...handlers,
    });
    const panel = await selectActivity();
    await userEvent.click(await within(panel).findByRole('button', { name: 'Comentarios (1)' }));
    return { api, list: await within(panel).findByRole('list', { name: 'Comentarios' }), panel };
  }

  it('lista los comentarios con autor y fecha', async () => {
    const { list } = await openComments();
    const item = within(list).getByRole('listitem');
    expect(item).toHaveTextContent('¿Aplica también a PayPal?');
    expect(item).toHaveTextContent('Marta');
    expect(item).toHaveTextContent('1/10/2026');
  });

  it('publica un comentario nuevo', async () => {
    const { api, panel } = await openComments({
      'GET /api/details/x1/comments': [
        () => json(200, [comment()]),
        () => json(200, [comment(), comment({ id: 'c2', text: 'Y Bizum' })]),
      ],
      'POST /api/details/x1/comments': () => json(201, comment({ id: 'c2', text: 'Y Bizum' })),
    });
    await userEvent.type(within(panel).getByLabelText('Nuevo comentario'), 'Y Bizum');
    await userEvent.click(within(panel).getByRole('button', { name: 'Publicar' }));
    await waitFor(() =>
      expect(within(panel).getByRole('list', { name: 'Comentarios' })).toHaveTextContent('Y Bizum'),
    );
    expect(api.requests.find((r) => r.method === 'POST')?.body).toEqual({ text: 'Y Bizum' });
  });

  it('edita y elimina los comentarios propios', async () => {
    const { api, list } = await openComments({
      'PATCH /api/comments/c1': () =>
        json(200, comment({ text: '¿Y Bizum?', editedAt: '2026-10-01T12:00:00.000Z' })),
      'DELETE /api/comments/c1': () => new Response(null, { status: 204 }),
    });
    await userEvent.click(within(list).getByRole('button', { name: 'Editar comentario' }));
    const field = within(list).getByLabelText('Editar comentario');
    await userEvent.clear(field);
    await userEvent.type(field, '¿Y Bizum?');
    await userEvent.click(within(list).getByRole('button', { name: 'Guardar comentario' }));
    await waitFor(() => expect(api.requests.some((r) => r.method === 'PATCH')).toBe(true));
    expect(api.requests.find((r) => r.method === 'PATCH')?.body).toEqual({ text: '¿Y Bizum?' });

    await userEvent.click(within(list).getByRole('button', { name: 'Eliminar comentario' }));
    await waitFor(() => expect(api.requests.some((r) => r.method === 'DELETE')).toBe(true));
  });

  it('sin permisos no hay acciones; con el proyecto cerrado no se publica', async () => {
    const { list, panel } = await openComments({
      'GET /api/projects/p1': () => json(200, project({ status: 'closed' })),
      'GET /api/details/x1/comments': () =>
        json(200, [comment({ permissions: { canEdit: false, canDelete: false } })]),
    });
    expect(within(list).queryByRole('button', { name: 'Editar comentario' })).toBeNull();
    expect(within(list).queryByRole('button', { name: 'Eliminar comentario' })).toBeNull();
    expect(within(panel).queryByLabelText('Nuevo comentario')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
  });
});
