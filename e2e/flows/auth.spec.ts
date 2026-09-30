import { randomInt } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newUser, registerUser } from './helpers';

// US1: registro, sesión, cierre de sesión y bloqueo (quickstart §1). Solo contra el stack local.

test('registro → "Mis proyectos" vacío, en menos de un minuto (SC-001)', async ({ page }) => {
  const started = Date.now();
  const user = newUser();
  await page.goto('/registro');
  await page.getByLabel('Nombre').fill(user.name);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(page.getByRole('heading', { name: 'Mis proyectos' })).toBeVisible();
  await expect(page.getByText('Todavía no tienes proyectos.')).toBeVisible();
  await expect(page.getByRole('banner')).toContainText(user.name);
  expect(Date.now() - started).toBeLessThan(60_000);
});

test('recargar la página conserva la sesión (refresh con la cookie)', async ({ page }) => {
  const user = newUser();
  await page.goto('/registro');
  await page.getByLabel('Nombre').fill(user.name);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Mis proyectos' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mis proyectos' })).toBeVisible();
  await expect(page).toHaveURL(/\/proyectos$/);

  // La cookie de sesión no es accesible desde JavaScript (httpOnly).
  expect(await page.evaluate(() => document.cookie)).not.toContain('rt=');
});

test('cerrar sesión bloquea las páginas protegidas (US1 escenario 4)', async ({
  page,
  request,
}) => {
  const user = await registerUser(request);
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Mis proyectos' })).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.goto('/proyectos');
  await expect(page).toHaveURL(/\/entrar\?redirect=%2Fproyectos$/);
});

test('el 6.º intento fallido muestra el aviso de bloqueo (US1 escenario 3)', async ({
  page,
  request,
}) => {
  // IP propia (Caddy reenvía X-Real-IP sin el borde de Railway): el bloqueo no afecta a las
  // demás pruebas, que comparten la IP del navegador.
  await page.setExtraHTTPHeaders({ 'x-real-ip': `198.18.${randomInt(256)}.${randomInt(256)}` });
  const user = await registerUser(request);
  await page.goto('/entrar');

  for (let attempt = 1; attempt <= 5; attempt++) {
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Contraseña').fill('contraseña-incorrecta');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('alert')).toHaveText('Email o contraseña incorrectos');
  }
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Demasiados intentos, espera 15 minutos');
});
