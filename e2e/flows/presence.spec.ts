import { login } from './diagrams';
import { expect, test } from './fixtures';
import {
  openWorkspace,
  projectWithPublishedDiagram,
  registerTeam,
  selectActivity,
  waitConnected,
} from './realtime';

// US2 de la 005 (quickstart §2): quién está conectado y qué actividad tiene seleccionada.

test('tres cuentas se ven entre sí; la selección de Luis y sus pestañas', async ({
  page,
  browser,
  request,
}) => {
  const { admin: ana, luis, marta } = await registerTeam(request);
  await login(page, ana);
  const diagram = await projectWithPublishedDiagram(page, ana, [luis, marta]);

  const anaPage = await openWorkspace(browser, ana, diagram);
  const martaPage = await openWorkspace(browser, marta, diagram);
  const luisPage = await openWorkspace(browser, luis, diagram);
  const connected = (target: typeof anaPage) =>
    target.getByRole('list', { name: 'Personas conectadas' });

  // Cada una ve a las otras dos, con su nombre.
  await expect(connected(anaPage)).toContainText(luis.name);
  await expect(connected(anaPage)).toContainText(marta.name);
  await expect(connected(luisPage).getByRole('listitem')).toHaveCount(2);

  // Luis selecciona "Emitir factura": los demás ven su indicador en esa actividad.
  await selectActivity(luisPage, diagram, 'Emitir factura');
  await waitConnected(luisPage);
  await expect(anaPage.getByLabel(`${luis.name} tiene seleccionada esta actividad`)).toBeVisible();

  // Una segunda pestaña de Luis no lo duplica.
  const secondTab = await luisPage.context().newPage();
  await secondTab.goto(`/proyectos/${diagram.projectId}/diagramas/${diagram.diagramId}`);
  await waitConnected(secondTab);
  await expect(connected(anaPage).getByRole('listitem')).toHaveCount(2);

  // Al cerrar ambas, desaparece en ≤ 10 s.
  await secondTab.close();
  await luisPage.close();
  await expect(connected(anaPage)).not.toContainText(luis.name, { timeout: 10_000 });
  await expect(connected(martaPage)).not.toContainText(luis.name, { timeout: 10_000 });
});
