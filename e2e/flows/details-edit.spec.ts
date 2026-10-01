import { login } from './diagrams';
import { createDetail, projectWithPublishedDiagram, registerTeam, selectActivity } from './details';
import { expect, test } from './fixtures';

// US2: editar y eliminar mis detalles (quickstart §2). Solo contra el stack local.

test('el autor edita su detalle, el historial muestra la versión anterior y otra persona no puede editarlo', async ({
  page,
  browser,
  request,
}) => {
  const { admin, luis, marta } = await registerTeam(request);
  await login(page, admin);
  const diagram = await projectWithPublishedDiagram(page, admin, [luis, marta]);
  const key = diagram.activities.get('Validar pago')!.key;
  await createDetail(request, luis, diagram.diagramId, key, { then: 'confirma el pago enseguida' });
  await page.context().clearCookies();
  await login(page, luis);

  const panel = await selectActivity(page, diagram, 'Validar pago');
  await panel.getByRole('button', { name: 'Editar' }).click();
  const form = panel.getByRole('form', { name: 'Editar requisito' });
  await form.getByLabel('Entonces (resultado)').fill('el sistema confirma el pago en 3 segundos');
  await form.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(panel.getByRole('article')).toContainText('en 3 segundos');

  await panel.getByRole('button', { name: 'Historial' }).click();
  const history = page.getByRole('dialog', { name: 'Historial del requisito' });
  await expect(history).toContainText('confirma el pago enseguida');
  await expect(history).toContainText(luis.name);

  // Marta no ve editar ni eliminar en el detalle de Luis.
  const other = await (await browser.newContext()).newPage();
  await login(other, marta);
  const martaPanel = await selectActivity(other, diagram, 'Validar pago');
  await expect(martaPanel.getByRole('article')).toBeVisible();
  await expect(martaPanel.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await expect(martaPanel.getByRole('button', { name: 'Eliminar' })).toHaveCount(0);
});

test('el autor y el Administrador editan a la vez: el segundo ve la comparación', async ({
  page,
  browser,
  request,
}) => {
  const { admin, luis } = await registerTeam(request);
  await login(page, admin);
  const diagram = await projectWithPublishedDiagram(page, admin, [luis]);
  const key = diagram.activities.get('Validar pago')!.key;
  await createDetail(request, luis, diagram.diagramId, key);
  const luisPage = await (await browser.newContext()).newPage();
  await login(luisPage, luis);

  // Los dos abren el formulario de edición antes de que nadie guarde.
  const forms = [];
  for (const tab of [page, luisPage]) {
    const panel = await selectActivity(tab, diagram, 'Validar pago');
    await panel.getByRole('button', { name: 'Editar' }).click();
    forms.push(panel.getByRole('form', { name: 'Editar requisito' }));
  }
  const [adminForm, luisForm] = forms;

  await adminForm!.getByLabel('Entonces (resultado)').fill('la versión de la Administradora');
  await adminForm!.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('article')).toContainText('la versión de la Administradora');

  await luisForm!.getByLabel('Entonces (resultado)').fill('la versión de Luis');
  await luisForm!.getByRole('button', { name: 'Guardar cambios' }).click();
  const dialog = luisPage.getByRole('dialog', { name: 'Otra persona modificó este requisito' });
  await expect(dialog).toContainText('la versión de Luis');
  await expect(dialog).toContainText('la versión de la Administradora');
  await dialog.getByRole('button', { name: 'Conservar lo mío' }).click();
  await expect(luisPage.getByRole('article')).toContainText('la versión de Luis');
});
