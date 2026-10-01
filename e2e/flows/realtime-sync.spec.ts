import { expect, test } from './fixtures';
import {
  openWorkspace,
  projectWithPublishedDiagram,
  registerTeam,
  selectActivity,
  waitConnected,
} from './realtime';
import { login } from './diagrams';

// US1 de la 005 (quickstart §1): los aportes aparecen en los demás navegadores sin recargar.

test('Luis registra un requisito y Ana lo ve al instante; Ana vota y valida y Luis lo ve', async ({
  page,
  browser,
  request,
}) => {
  const { admin: ana, luis, marta } = await registerTeam(request);
  await login(page, ana);
  const diagram = await projectWithPublishedDiagram(page, ana, [luis]);
  const other = await projectWithPublishedDiagram(page, marta);

  const anaPage = await openWorkspace(browser, ana, diagram);
  const anaPanel = await selectActivity(anaPage, diagram, 'Validar pago');
  await waitConnected(anaPage);
  const luisPage = await openWorkspace(browser, luis, diagram);
  const luisPanel = await selectActivity(luisPage, diagram, 'Validar pago');
  await waitConnected(luisPage);
  const martaPage = await openWorkspace(browser, marta, other);
  const martaPanel = await selectActivity(martaPage, other, 'Validar pago');
  await waitConnected(martaPage);

  await luisPanel.getByLabel('Dado (contexto)').fill('el cliente tiene productos en el carrito');
  await luisPanel.getByLabel('Cuando (acción)').fill('paga con tarjeta');
  await luisPanel.getByLabel('Entonces (resultado)').fill('el sistema confirma el pago');
  const started = Date.now();
  await luisPanel.getByRole('button', { name: 'Guardar requisito' }).click();

  // Ana: el detalle en su panel y el contador en el diagrama, sin recargar y en < 1 s.
  await expect(anaPanel.getByRole('article')).toContainText(luis.name, { timeout: 2000 });
  const seconds = (Date.now() - started) / 1000;
  console.log(`[realtime] detalle visible en el otro navegador en ${seconds.toFixed(2)} s`);
  expect(seconds).toBeLessThan(1);
  await expect(
    anaPage.getByRole('main').getByRole('button', { name: '1 requisito(s): mostrar notas' }),
  ).toBeVisible();

  // Ana vota y valida: Luis ve el voto y el estado.
  const card = anaPanel.getByRole('article');
  await card.getByRole('button', { name: 'Votar' }).click();
  await card.getByRole('button', { name: 'Validar' }).click();
  await expect(luisPanel.getByRole('article')).toContainText('1 voto(s)');
  await expect(luisPanel.getByRole('article')).toContainText('Validado');

  // Marta, en otro proyecto, no recibe nada.
  await expect(martaPanel.getByRole('article')).toHaveCount(0);
});
