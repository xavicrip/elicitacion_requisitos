import { imageReady, login } from './diagrams';
import { draftWithoutActivities } from './detection';
import { expect, test } from './fixtures';
import { registerUser } from './helpers';
import { waitConnected } from './realtime';

// US1 de la 006 (quickstart §1): el Administrador lanza la detección sobre un borrador sin
// actividades y ve el progreso y las zonas propuestas, con el worker real (OpenCV y Tesseract).

test('detectar actividades en un borrador propone las zonas con su nombre', async ({
  page,
  request,
}) => {
  const ana = await registerUser(request);
  await login(page, ana);
  const draft = await draftWithoutActivities(page, ana.accessToken);
  await page.goto(`/proyectos/${draft.projectId}/diagramas/${draft.diagramId}`);
  await imageReady(page);
  await waitConnected(page);

  const panel = page.getByRole('region', { name: 'Detección asistida' });
  await panel.getByRole('button', { name: 'Detectar actividades' }).click();
  await expect(panel.getByRole('status')).toContainText('Detectando actividades');
  await expect(panel.getByRole('status')).toContainText('Se propusieron', { timeout: 60_000 });

  const proposals = page.getByRole('list', { name: 'Propuestas de la detección' });
  const items = proposals.getByRole('listitem');
  await expect(items).toHaveCount(6);
  for (const name of ['Seleccionar producto', 'Validar pago', 'Emitir factura', 'Enviar pedido']) {
    await expect(
      proposals.getByRole('listitem', { name: new RegExp(`Propuesta: ${name} ·`) }),
    ).toBeVisible();
  }
});
