import { login } from './diagrams';
import { createDetail, projectWithPublishedDiagram, registerTeam, selectActivity } from './details';
import { expect, test } from './fixtures';

// US5: moderar detalles (quickstart §5). Solo contra el stack local.

test('duplicado, descarte con motivo, filtro por estado y proyecto cerrado', async ({
  page,
  browser,
  request,
}) => {
  const { admin, luis, marta } = await registerTeam(request);
  await login(page, admin);
  const diagram = await projectWithPublishedDiagram(page, admin, [luis, marta]);
  const key = diagram.activities.get('Validar pago')!.key;
  await createDetail(request, luis, diagram.diagramId, key, {
    when: 'paga con tarjeta',
    then: 'el sistema confirma el pago',
  });
  const cobro = await createDetail(request, marta, diagram.diagramId, key, {
    when: 'paga con tarjeta',
    then: 'el sistema confirma el cobro',
  });
  // Luis vota antes de que se cierre el proyecto: después tampoco podrá retirar el voto.
  const voted = await request.put(`/api/details/${cobro.id}/vote`, {
    headers: { authorization: `Bearer ${luis.accessToken}` },
  });
  expect(voted.status()).toBe(200);
  await createDetail(request, luis, diagram.diagramId, key, {
    when: 'paga en efectivo',
    then: 'el repartidor cobra al entregar',
  });

  const panel = await selectActivity(page, diagram, 'Validar pago');
  const card = (text: string) => panel.getByRole('article').filter({ hasText: text });

  // Duplicado: atenuado y con enlace al original.
  await card('confirma el cobro').getByRole('button', { name: 'Marcar como duplicado' }).click();
  await card('confirma el cobro')
    .getByLabel('Original')
    .selectOption({ label: 'Cuando paga con tarjeta → Entonces el sistema confirma el pago' });
  await card('confirma el cobro').getByRole('button', { name: 'Confirmar duplicado' }).click();
  await expect(card('confirma el cobro')).toHaveClass(/opacity-60/);
  await expect(
    card('confirma el cobro').getByRole('link', { name: 'Ver el original' }),
  ).toBeVisible();

  // Descarte con motivo.
  await card('cobra al entregar').getByRole('button', { name: 'Descartar' }).click();
  await card('cobra al entregar').getByLabel('Motivo del descarte').fill('Fuera de alcance');
  await card('cobra al entregar').getByRole('button', { name: 'Confirmar descarte' }).click();
  await expect(card('cobra al entregar')).toContainText('Motivo del descarte: Fuera de alcance');

  // Validar y filtrar por estado.
  await card('confirma el pago').getByRole('button', { name: 'Validar' }).click();
  await expect(card('confirma el pago')).toContainText('Validado');
  await panel.getByLabel('Estado').selectOption({ label: 'Validado' });
  await expect(panel.getByRole('article')).toHaveCount(1);
  await expect(panel.getByRole('article')).toContainText('confirma el pago');

  // Luis ve el motivo del descarte de su detalle.
  const luisPage = await (await browser.newContext()).newPage();
  await login(luisPage, luis);
  const luisPanel = await selectActivity(luisPage, diagram, 'Validar pago');
  await expect(
    luisPanel.getByRole('article').filter({ hasText: 'cobra al entregar' }),
  ).toContainText('Motivo del descarte: Fuera de alcance');

  // Al cerrar el proyecto desaparecen el formulario y los votos.
  await page.request.post(`/api/projects/${diagram.projectId}/status`, {
    headers: { authorization: `Bearer ${admin.accessToken}` },
    data: { action: 'close' },
  });
  const closedPanel = await selectActivity(luisPage, diagram, 'Validar pago');
  await expect(closedPanel.getByRole('article').first()).toBeVisible();
  await expect(closedPanel.getByRole('button', { name: 'Guardar requisito' })).toHaveCount(0);
  const votes = closedPanel.getByRole('button', { name: 'Votar' });
  await expect(votes.and(closedPanel.locator('[aria-pressed="true"]'))).toHaveCount(1);
  for (const vote of await votes.all()) {
    await expect(vote).toBeDisabled();
  }
});
