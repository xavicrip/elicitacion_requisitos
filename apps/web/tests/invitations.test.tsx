import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, routes } from '../src/app/router';
import { useAuthStore } from '../src/lib/auth-store';
import { json, mockApi } from './helpers/api';

const ana = { id: 'u1', name: 'Ana', email: 'ana@example.com' };
const luis = { id: 'u2', name: 'Luis', email: 'luis@example.com' };
const session = (user: typeof ana) => ({ accessToken: `token-${user.id}`, expiresIn: 900, user });
const project = (myRole: 'admin' | 'participant') => ({
  id: 'p1',
  name: 'Tienda en línea',
  description: '',
  status: 'open',
  myRole,
  lastActivityAt: '2026-09-30T10:00:00.000Z',
  memberCount: 2,
  createdAt: '2026-09-30T09:00:00.000Z',
});
const member = (user: typeof ana, role: 'admin' | 'participant') => ({
  userId: user.id,
  name: user.name,
  email: user.email,
  role,
  joinedAt: '2026-09-30T09:00:00.000Z',
});
const invitation = (status = 'active') => ({
  id: 'i1',
  status,
  expiresAt: '2026-10-07T10:00:00.000Z',
  uses: 0,
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

const panel = async () => within(await screen.findByRole('region', { name: 'Miembros' }));

describe('MembersPanel (Administrador)', () => {
  const adminApi = (overrides = {}) =>
    mockApi({
      'GET /api/projects/p1': () => json(200, project('admin')),
      'GET /api/projects/p1/members': () =>
        json(200, [member(ana, 'admin'), member(luis, 'participant')]),
      'GET /api/projects/p1/invitations': () => json(200, []),
      ...overrides,
    });

  it('lista los miembros con su email y rol', async () => {
    useAuthStore.getState().setSession(session(ana));
    adminApi();
    renderAt('/proyectos/p1');
    const members = await panel();
    const row = (await members.findByText('Luis')).closest('li')!;
    expect(row).toHaveTextContent('luis@example.com');
    expect(within(row).getByRole('combobox', { name: 'Rol de Luis' })).toHaveValue('participant');
  });

  it('cambia el rol de un miembro (US3 escenario 5)', async () => {
    useAuthStore.getState().setSession(session(ana));
    const { requests } = adminApi({
      'PATCH /api/projects/p1/members/u2': () => json(200, member(luis, 'admin')),
    });
    renderAt('/proyectos/p1');
    const members = await panel();
    await userEvent.selectOptions(
      await members.findByRole('combobox', { name: 'Rol de Luis' }),
      'admin',
    );
    await waitFor(() =>
      expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({ role: 'admin' }),
    );
  });

  it('muestra el error si el cambio dejaría el proyecto sin Administradores', async () => {
    useAuthStore.getState().setSession(session(ana));
    adminApi({
      'PATCH /api/projects/p1/members/u1': () =>
        json(409, {
          code: 'LAST_ADMIN',
          message: 'El proyecto necesita al menos un Administrador',
        }),
    });
    renderAt('/proyectos/p1');
    const members = await panel();
    await userEvent.selectOptions(
      await members.findByRole('combobox', { name: 'Rol de Ana' }),
      'participant',
    );
    expect(await members.findByRole('alert')).toHaveTextContent(
      'El proyecto necesita al menos un Administrador',
    );
  });

  it('retira a un miembro (US3 escenario 4)', async () => {
    useAuthStore.getState().setSession(session(ana));
    const { handlers, requests } = adminApi({
      'DELETE /api/projects/p1/members/u2': () => new Response(null, { status: 204 }),
    });
    renderAt('/proyectos/p1');
    const members = await panel();
    handlers['GET /api/projects/p1/members'] = () => json(200, [member(ana, 'admin')]);
    await userEvent.click(await members.findByRole('button', { name: 'Retirar a Luis' }));
    await waitFor(() => expect(members.queryByText('Luis')).not.toBeInTheDocument());
    expect(requests.some((r) => r.method === 'DELETE' && r.url.endsWith('/members/u2'))).toBe(true);
  });

  it('genera un enlace, lo copia y lo revoca (FR-008)', async () => {
    useAuthStore.getState().setSession(session(ana));
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const url = 'https://web.example.com/invitacion/abc123';
    const { handlers, requests } = adminApi({
      'POST /api/projects/p1/invitations': () => json(201, { ...invitation(), url }),
      'DELETE /api/projects/p1/invitations/i1': () => new Response(null, { status: 204 }),
    });
    renderAt('/proyectos/p1');
    const members = await panel();

    handlers['GET /api/projects/p1/invitations'] = () => json(200, [invitation()]);
    await userEvent.click(await members.findByRole('button', { name: 'Generar enlace' }));
    expect(await members.findByDisplayValue(url)).toBeInTheDocument();
    await userEvent.click(members.getByRole('button', { name: 'Copiar enlace' }));
    expect(writeText).toHaveBeenCalledWith(url);
    expect(await members.findByText('Enlace copiado')).toBeInTheDocument();

    const item = (await members.findByText(/Activa/)).closest('li')!;
    handlers['GET /api/projects/p1/invitations'] = () => json(200, [invitation('revoked')]);
    await userEvent.click(within(item).getByRole('button', { name: 'Revocar' }));
    expect(await members.findByText(/Revocada/)).toBeInTheDocument();
    expect(requests.some((r) => r.method === 'DELETE' && r.url.endsWith('/invitations/i1'))).toBe(
      true,
    );
  });
});

describe('MembersPanel (Participante)', () => {
  it('ve a los miembros, sin controles de administración, y puede abandonar el proyecto', async () => {
    useAuthStore.getState().setSession(session(luis));
    const { requests } = mockApi({
      'GET /api/projects/p1': () => json(200, project('participant')),
      'GET /api/projects/p1/members': () =>
        json(200, [member(ana, 'admin'), member(luis, 'participant')]),
      'DELETE /api/projects/p1/members/u2': () => new Response(null, { status: 204 }),
      'GET /api/projects': () => json(200, []),
    });
    const router = renderAt('/proyectos/p1');
    const members = await panel();
    expect(await members.findByText('Ana')).toBeInTheDocument();
    expect(members.queryByRole('combobox')).not.toBeInTheDocument();
    expect(members.queryByRole('button', { name: 'Generar enlace' })).not.toBeInTheDocument();
    expect(members.queryByRole('button', { name: /Retirar/ })).not.toBeInTheDocument();
    expect(requests.some((r) => r.url === '/api/projects/p1/invitations')).toBe(false);

    await userEvent.click(members.getByRole('button', { name: 'Abandonar proyecto' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/proyectos'));
    expect(requests.some((r) => r.method === 'DELETE' && r.url.endsWith('/members/u2'))).toBe(true);
  });
});

describe('AcceptInvitationPage (US3 escenarios 2 y 3)', () => {
  it('una invitación revocada o caducada muestra un mensaje claro', async () => {
    mockApi({
      'GET /api/invitations/tok': () =>
        json(410, { code: 'INVITATION_INVALID', message: 'Esta invitación ya no es válida' }),
      'POST /api/auth/refresh': () => json(401, { code: 'SESSION_EXPIRED', message: 'x' }),
    });
    renderAt('/invitacion/tok');
    expect(
      await screen.findByRole('heading', { name: 'Esta invitación ya no es válida' }),
    ).toBeInTheDocument();
  });

  it('con sesión: muestra el proyecto y se une con un clic', async () => {
    useAuthStore.getState().setSession(session(luis));
    const { requests } = mockApi({
      'GET /api/invitations/tok': () => json(200, { projectName: 'Tienda en línea' }),
      'POST /api/invitations/tok/accept': () =>
        json(200, { ...project('participant'), memberCount: undefined }),
      'GET /api/projects/p1': () => json(200, project('participant')),
      'GET /api/projects/p1/members': () => json(200, []),
    });
    const router = renderAt('/invitacion/tok');
    expect(await screen.findByText(/Tienda en línea/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unirme al proyecto' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/proyectos/p1'));
    expect(requests.some((r) => r.method === 'POST' && r.url.endsWith('/accept'))).toBe(true);
  });

  it('sin cuenta: se registra desde el enlace y la unión se completa sola', async () => {
    const { requests } = mockApi({
      'GET /api/invitations/tok': () => json(200, { projectName: 'Tienda en línea' }),
      'POST /api/auth/refresh': () => json(401, { code: 'SESSION_EXPIRED', message: 'x' }),
      'POST /api/auth/register': () => json(201, session(luis)),
      'POST /api/invitations/tok/accept': () => json(200, project('participant')),
      'GET /api/projects/p1': () => json(200, project('participant')),
      'GET /api/projects/p1/members': () => json(200, []),
    });
    const router = renderAt('/invitacion/tok');
    const main = within(await screen.findByRole('main'));
    await userEvent.click(await main.findByRole('link', { name: 'Crear cuenta' }));

    await userEvent.type(await screen.findByLabelText('Nombre'), 'Luis');
    await userEvent.type(screen.getByLabelText('Email'), 'luis@example.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'una-frase-larga');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/proyectos/p1'));
    expect(requests.filter((r) => r.url === '/api/invitations/tok/accept')).toHaveLength(1);
  });

  it('sin sesión ofrece también iniciar sesión conservando el enlace', async () => {
    mockApi({
      'GET /api/invitations/tok': () => json(200, { projectName: 'Tienda en línea' }),
      'POST /api/auth/refresh': () => json(401, { code: 'SESSION_EXPIRED', message: 'x' }),
    });
    renderAt('/invitacion/tok');
    const main = within(await screen.findByRole('main'));
    expect(await main.findByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute(
      'href',
      '/entrar?redirect=%2Finvitacion%2Ftok%3Funirse%3D1',
    );
  });
});
