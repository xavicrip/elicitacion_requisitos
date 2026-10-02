import type { Page } from '@playwright/test';
import { canvasState, login, toScreen } from './diagrams';
import { IMAGE, type PublishedDiagram } from './details';
import { expect, test } from './fixtures';
import { openWorkspace, projectWithPublishedDiagram, registerTeam } from './realtime';

// US3 de la 005 (quickstart §3): el cursor de Luis aparece sobre la misma actividad en la
// pantalla de Ana aunque cada uno tenga su zoom; Ana puede ocultarlo.

/** Rectángulo en pantalla de una actividad, con la cámara actual de `page`. */
async function activityOnScreen(page: Page, diagram: PublishedDiagram, label: string) {
  const { bbox } = diagram.activities.get(label)!;
  const topLeft = await toScreen(page, { x: bbox.x * IMAGE.width, y: bbox.y * IMAGE.height });
  const bottomRight = await toScreen(page, {
    x: (bbox.x + bbox.w) * IMAGE.width,
    y: (bbox.y + bbox.h) * IMAGE.height,
  });
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
    center: { x: (topLeft.x + bottomRight.x) / 2, y: (topLeft.y + bottomRight.y) / 2 },
  };
}

const zoom = async (page: Page) => (await canvasState(page))!.camera.zoom;

test('cursores en vivo con zoom distinto; "Ocultar cursores"', async ({
  page,
  browser,
  request,
}) => {
  const { admin: ana, luis } = await registerTeam(request);
  await login(page, ana);
  const diagram = await projectWithPublishedDiagram(page, ana, [luis]);

  const anaPage = await openWorkspace(browser, ana, diagram);
  const luisPage = await openWorkspace(browser, luis, diagram);
  const fit = await zoom(anaPage);

  // Ana acerca con la rueda sobre "Validar pago" (zoom hacia el cursor) hasta ≥ 200 %; Luis
  // aleja con el teclado hasta ~50 %.
  const target = await activityOnScreen(anaPage, diagram, 'Validar pago');
  await anaPage.mouse.move(target.center.x, target.center.y);
  for (let i = 0; i < 30 && (await zoom(anaPage)) / fit < 2; i++) {
    await anaPage.mouse.wheel(0, -200);
    await anaPage.waitForTimeout(50);
  }
  expect((await zoom(anaPage)) / fit).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < 3; i++) await luisPage.keyboard.press('-');
  await expect.poll(async () => (await zoom(luisPage)) / fit).toBeLessThan(0.6);

  // Luis pasa el puntero por el centro de "Validar pago" en su pantalla.
  const onLuis = await activityOnScreen(luisPage, diagram, 'Validar pago');
  await luisPage.mouse.move(onLuis.center.x - 5, onLuis.center.y - 5);
  await luisPage.mouse.move(onLuis.center.x, onLuis.center.y, { steps: 3 });

  // En la de Ana, la punta de su cursor cae dentro de la zona, con el nombre de Luis.
  const cursor = anaPage.getByTestId('remote-cursor');
  await expect(cursor).toContainText(luis.name);
  const onAna = await activityOnScreen(anaPage, diagram, 'Validar pago');
  const tip = async () => {
    const box = (await cursor.boundingBox())!;
    return { x: box.x, y: box.y };
  };
  // La interpolación lo lleva hasta el centro de la zona (a unos px, por el redondeo).
  await expect
    .poll(async () => {
      const { x, y } = await tip();
      return Math.max(Math.abs(x - onAna.center.x), Math.abs(y - onAna.center.y));
    })
    .toBeLessThan(4);
  const { x, y } = await tip();
  expect(x >= onAna.left && x <= onAna.right && y >= onAna.top && y <= onAna.bottom).toBe(true);

  // Ana los oculta: deja de verlo.
  await anaPage.getByRole('button', { name: 'Ocultar cursores' }).click();
  await expect(cursor).toHaveCount(0);
  await luisPage.mouse.move(onLuis.center.x + 10, onLuis.center.y);
  await anaPage.waitForTimeout(300);
  await expect(cursor).toHaveCount(0);
});
