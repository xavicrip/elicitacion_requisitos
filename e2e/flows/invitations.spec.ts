import { randomInt } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { newUser, registerUser, type TestUser } from './helpers';

// US3 (quickstart §3): invitar, unirse desde el enlace, permisos del Participante, revocar y
// retirar. Dos navegadores independientes: Ana (Administradora) y Luis (invitado).

async function newBrowser(browser: Browser, baseURL: string) {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-real-ip': `198.19.${randomInt(256)}.${randomInt(1, 255)}` },
  });
  return context.newPage();
}

async function login(page: Page, user: TestUser) {
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Mis proyectos' })).toBeVisible();
}

test('invitar, unirse, permisos del Participante, revocar y retirar', async ({
  page,
  request,
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const started = Date.now();

  // Ana crea el proyecto y genera el enlace (SC-002: en menos de 2 minutos en total).
  const ana = await registerUser(request, newUser('Ana'));
  await login(page, ana);
  const name = `Tienda en línea ${Date.now()}`;
  await page.getByLabel('Nombre del proyecto').fill(name);
  await page.getByRole('button', { name: 'Crear proyecto' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  const projectUrl = page.url();

  const members = page.getByRole('region', { name: 'Miembros' });
  await members.getByRole('button', { name: 'Generar enlace' }).click();
  const link = await members.getByRole('textbox', { name: 'Enlace de invitación' }).inputValue();
  expect(link).toMatch(/\/invitacion\/[A-Za-z0-9_-]{43}$/);
  expect(Date.now() - started).toBeLessThan(120_000);

  // Luis abre el enlace sin cuenta, se registra y queda unido como Participante.
  const luisPage = await newBrowser(browser, baseURL);
  const luis = newUser('Luis');
  await luisPage.goto(link);
  await expect(luisPage.getByText(name)).toBeVisible();
  await luisPage.getByRole('main').getByRole('link', { name: 'Crear cuenta' }).click();
  await luisPage.getByLabel('Nombre').fill(luis.name);
  await luisPage.getByLabel('Email').fill(luis.email);
  await luisPage.getByLabel('Contraseña').fill(luis.password);
  await luisPage.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(luisPage.getByRole('heading', { name })).toBeVisible();
  await expect(luisPage.getByText('Participante').first()).toBeVisible();

  // El Participante no puede crear invitaciones: la API responde 403 (US4).
  const luisLogin = await request.post('/api/auth/login', {
    data: { email: luis.email, password: luis.password },
  });
  const { accessToken } = (await luisLogin.json()) as { accessToken: string };
  const projectId = projectUrl.split('/proyectos/')[1]!;
  const forbidden = await request.post(`/api/projects/${projectId}/invitations`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(forbidden.status()).toBe(403);

  // Ana revoca el enlace: una tercera persona ve el mensaje y no se une (US3 escenario 3).
  await page.reload();
  await members.getByRole('button', { name: 'Revocar' }).click();
  await expect(members.getByText(/Revocada/)).toBeVisible();
  const thirdPage = await newBrowser(browser, baseURL);
  await thirdPage.goto(link);
  await expect(
    thirdPage.getByRole('heading', { name: 'Esta invitación ya no es válida' }),
  ).toBeVisible();

  // Ana retira a Luis: al recargar, Luis ya no ve el proyecto (US3 escenario 4).
  await members.getByRole('button', { name: `Retirar a ${luis.name}` }).click();
  await expect(members.getByText(luis.name)).toHaveCount(0);
  await luisPage.reload();
  await expect(luisPage.getByRole('heading', { name: 'Proyecto no encontrado' })).toBeVisible();

  // Ana, única Administradora, no puede degradarse (edge case).
  await members.getByRole('combobox', { name: `Rol de ${ana.name}` }).selectOption('participant');
  await expect(members.getByRole('alert')).toHaveText(
    'El proyecto necesita al menos un Administrador',
  );
});
