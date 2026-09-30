import { expect, test } from './fixtures';
import { registerUser } from './helpers';

// US2: ciclo de vida de un proyecto (quickstart §2). Solo contra el stack local.

test('crear → abrir → cerrar → reabrir → eliminar con confirmación', async ({ page, request }) => {
  const user = await registerUser(request);
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Mis proyectos' })).toBeVisible();

  // Crear: nace en borrador, con quien lo crea como Administrador (US2 escenario 1).
  const name = `Tienda en línea ${Date.now()}`;
  await page.getByLabel('Nombre del proyecto').fill(name);
  await page.getByLabel('Descripción').fill('Ventas por internet');
  await page.getByRole('button', { name: 'Crear proyecto' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('Borrador')).toBeVisible();
  await expect(page.getByText('Administrador')).toBeVisible();

  // Ciclo de estados (FR-006).
  await page.getByRole('button', { name: 'Abrir proyecto' }).click();
  await expect(page.getByText('Abierto')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar proyecto' }).click();
  await expect(page.getByText('Cerrado')).toBeVisible();
  await page.getByRole('button', { name: 'Reabrir proyecto' }).click();
  await expect(page.getByText('Abierto')).toBeVisible();

  // "Mis proyectos" refleja el estado.
  await page.getByRole('link', { name: 'Mis proyectos' }).click();
  const item = page.getByRole('listitem').filter({ hasText: name });
  await expect(item).toContainText('Abierto');
  await expect(item).toContainText('Administrador');

  // Eliminar exige escribir el nombre exacto (US2 escenario 4).
  await item.getByRole('link', { name }).click();
  await page.getByRole('button', { name: 'Eliminar proyecto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Eliminar proyecto' });
  const confirm = dialog.getByRole('button', { name: 'Eliminar definitivamente' });
  await dialog.getByRole('textbox').fill(name.toLowerCase());
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox').fill(name);
  await confirm.click();

  await expect(page).toHaveURL(/\/proyectos$/);
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
});
