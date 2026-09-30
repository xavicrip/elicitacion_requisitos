import { expect, test } from './fixtures';
import { registerUser } from './helpers';

// US4 (quickstart §4): un proyecto ajeno no existe para quien no es miembro, ni por la
// interfaz ni por petición directa a la API.

test('un proyecto ajeno responde "no encontrado" por URL y 404 por la API', async ({
  page,
  request,
}) => {
  const owner = await registerUser(request);
  const created = await request.post('/api/projects', {
    headers: { authorization: `Bearer ${owner.accessToken}` },
    data: { name: `Privado ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  const intruder = await registerUser(request);
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(intruder.email);
  await page.getByLabel('Contraseña').fill(intruder.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Mis proyectos' })).toBeVisible();

  // Por URL: la misma vista que un proyecto inexistente.
  await page.goto(`/proyectos/${id}`);
  await expect(page.getByRole('heading', { name: 'Proyecto no encontrado' })).toBeVisible();

  // Por petición directa: 404 en lectura y en las acciones de administración.
  const bearer = { authorization: `Bearer ${intruder.accessToken}` };
  expect((await request.get(`/api/projects/${id}`, { headers: bearer })).status()).toBe(404);
  expect(
    (
      await request.patch(`/api/projects/${id}`, { headers: bearer, data: { name: 'Mío' } })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(`/api/projects/${id}/status`, {
        headers: bearer,
        data: { action: 'open' },
      })
    ).status(),
  ).toBe(404);

  // Y el proyecto sigue intacto para su dueño.
  const own = await request.get(`/api/projects/${id}`, {
    headers: { authorization: `Bearer ${owner.accessToken}` },
  });
  expect(await own.json()).toMatchObject({ status: 'draft', myRole: 'admin' });
});
