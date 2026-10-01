import { login } from './diagrams';
import { createDetail, projectWithPublishedDiagram, registerTeam, selectActivity } from './details';
import { expect, test } from './fixtures';

// US4: votar y comentar detalles (quickstart §4). Solo contra el stack local.

test('Marta vota y comenta el detalle de Luis; Luis no puede votar el suyo', async ({
  page,
  browser,
  request,
}) => {
  const { admin, luis, marta } = await registerTeam(request);
  await login(page, admin);
  const diagram = await projectWithPublishedDiagram(page, admin, [luis, marta]);
  await createDetail(request, luis, diagram.diagramId, diagram.activities.get('Validar pago')!.key);
  await page.context().clearCookies();
  await login(page, marta);

  const panel = await selectActivity(page, diagram, 'Validar pago');
  const card = panel.getByRole('article');
  const vote = card.getByRole('button', { name: 'Votar' });
  await vote.click();
  await expect(vote).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toContainText('1 voto(s)');
  await vote.click();
  await expect(vote).toHaveAttribute('aria-pressed', 'false');
  await expect(card).toContainText('0 voto(s)');

  await card.getByRole('button', { name: 'Comentarios (0)' }).click();
  await card.getByLabel('Nuevo comentario').fill('¿Aplica también a PayPal?');
  await card.getByRole('button', { name: 'Publicar' }).click();
  const comments = card.getByRole('list', { name: 'Comentarios' });
  await expect(comments).toContainText('¿Aplica también a PayPal?');
  await expect(comments).toContainText(marta.name);
  await expect(card.getByRole('button', { name: 'Comentarios (1)' })).toBeVisible();

  // Luis no puede votar su propio detalle.
  const luisPage = await (await browser.newContext()).newPage();
  await login(luisPage, luis);
  const luisPanel = await selectActivity(luisPage, diagram, 'Validar pago');
  await expect(
    luisPanel.getByRole('article').getByRole('button', { name: 'Votar' }),
  ).toBeDisabled();
});
