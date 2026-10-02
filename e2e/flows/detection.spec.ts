import { imageReady, login, uploadVersion } from './diagrams';
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

test('revisar las propuestas: corregir, descartar, aceptar en bloque y publicar', async ({
  page,
  request,
}) => {
  const ana = await registerUser(request);
  await login(page, ana);
  const draft = await draftWithoutActivities(page, ana.accessToken);
  await page.goto(`/proyectos/${draft.projectId}/diagramas/${draft.diagramId}`);
  await imageReady(page);
  await waitConnected(page);
  await page.getByRole('button', { name: 'Detectar actividades' }).click();
  const review = page.getByRole('region', { name: 'Propuestas pendientes' });
  await expect(review.getByRole('heading', { name: 'Propuestas pendientes (6)' })).toBeVisible({
    timeout: 60_000,
  });

  // Corrige el nombre de una y la acepta; descarta otra.
  const validar = review.getByRole('listitem', { name: 'Propuesta Validar pago' });
  await validar.getByLabel('Nombre').fill('Validar el pago');
  await validar.getByRole('button', { name: 'Aceptar' }).click();
  await review
    .getByRole('listitem', { name: 'Propuesta Fin' })
    .getByRole('button', { name: 'Descartar' })
    .click();
  await expect(review.getByRole('heading', { name: 'Propuestas pendientes (4)' })).toBeVisible();
  const editor = page.getByRole('complementary', { name: 'Editor de actividades' });
  await expect(editor.getByRole('button', { name: /Validar el pago/ })).toBeVisible();

  // Con propuestas pendientes no se publica.
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Revisa las 4 propuesta(s) de la detección')).toBeVisible();

  // Acepta el resto en bloque y publica.
  await review.getByRole('button', { name: /Aceptar todas las de confianza alta \(4\)/ }).click();
  await expect(review).toHaveCount(0);
  await expect(editor.getByRole('heading', { name: 'Actividades (5)' })).toBeVisible();
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText(/· Publicado/)).toBeVisible();

  // Una versión nueva hereda las actividades: al volver a detectar, todas son posibles duplicados.
  await uploadVersion(page, ana.accessToken, draft.diagramId);
  await page.reload();
  await imageReady(page);
  await page.getByRole('button', { name: 'Detectar actividades' }).click();
  await expect(review.getByRole('heading', { name: /Propuestas pendientes/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    review.getByText('Posible duplicado de una actividad existente', { exact: false }),
  ).toHaveCount(5);
});
