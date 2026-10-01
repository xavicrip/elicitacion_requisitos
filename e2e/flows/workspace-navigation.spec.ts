import type { Page } from '@playwright/test';
import {
  canvasState,
  fixtureActivities,
  imageReady,
  login,
  openProject,
  publishFixture,
  toScreen,
  uploadVersion,
} from './diagrams';
import { expect, test } from './fixtures';
import { registerUser } from './helpers';

// US4: navegar el diagrama (quickstart §4) sobre grande-4000x3000.png publicado.

const IMAGE = { width: 4000, height: 3000 };

async function fitZoom(page: Page) {
  const box = await page.getByRole('main').locator('canvas').boundingBox();
  return Math.min(box!.width / IMAGE.width, box!.height / IMAGE.height);
}

const zoom = async (page: Page) => (await canvasState(page))!.camera.zoom;
const center = async (page: Page) => (await canvasState(page))!.camera.center;

async function openPublished(page: Page, request: Parameters<typeof registerUser>[0]) {
  const user = await registerUser(request);
  await login(page, user);
  const projectId = await openProject(page, user.accessToken);
  const version = await publishFixture(page, user.accessToken, projectId, 'grande-4000x3000.png');
  await page.goto(`/proyectos/${projectId}/diagramas/${version.diagramId}`);
  await imageReady(page);
  return { user, projectId, version };
}

test('rueda, "0", minimapa y teclado sobre un diagrama grande', async ({ page, request }) => {
  await openPublished(page, request);
  expect((await canvasState(page))?.mode).toBe('view');
  const fit = await fitZoom(page);
  expect(await zoom(page)).toBeCloseTo(fit, 5);

  // Rueda: el zoom se queda en el 10 %–800 % del ajuste.
  const middle = await toScreen(page, { x: 2000, y: 1500 });
  await page.mouse.move(middle.x, middle.y);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -400);
  await expect.poll(() => zoom(page)).toBeGreaterThan(fit * 7);
  expect(await zoom(page)).toBeLessThanOrEqual(fit * 8 + 1e-6);
  // Cada evento de rueda reduce el zoom un 5 %: del 800 % al mínimo hacen falta unos 90.
  for (let i = 0; i < 120; i++) await page.mouse.wheel(0, 400);
  await expect.poll(() => zoom(page)).toBeLessThan(fit * 0.2);
  expect(await zoom(page)).toBeGreaterThanOrEqual(fit * 0.1 - 1e-6);

  // "0" vuelve a ajustar.
  await page.keyboard.press('0');
  await expect.poll(() => zoom(page)).toBeCloseTo(fit, 5);
  expect(await center(page)).toEqual({ x: 2000, y: 1500 });

  // Clic en el minimapa: centra la vista en ese punto.
  const minimap = page.getByRole('button', { name: 'Minimapa: haz clic para centrar la vista' });
  const box = (await minimap.boundingBox())!;
  await page.keyboard.press('+');
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await expect.poll(async () => (await center(page)).x).toBeCloseTo(1000, -1);
  expect((await center(page)).y).toBeCloseTo(750, -1);

  // Teclado: + y - cambian el zoom; las flechas desplazan.
  const before = await zoom(page);
  await page.keyboard.press('+');
  await expect.poll(() => zoom(page)).toBeCloseTo(before * 1.25, 5);
  await page.keyboard.press('-');
  await expect.poll(() => zoom(page)).toBeCloseTo(before, 5);
  const { x } = await center(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await center(page)).x).toBeGreaterThan(x);
});

test('Tab hasta una actividad y Enter la selecciona y la anuncia', async ({ page, request }) => {
  await openPublished(page, request);
  const list = page.getByRole('navigation', { name: 'Actividades del diagrama' });
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (await list.evaluate((nav) => nav.contains(document.activeElement))) break;
  }
  const first = fixtureActivities('grande-4000x3000.json')[0]!;
  await expect(list.getByRole('button').first()).toBeFocused();
  await expect.poll(async () => (await canvasState(page))?.hoveredActivityKey).toBeTruthy();

  await page.keyboard.press('Enter');
  await expect.poll(async () => (await canvasState(page))?.selectedActivityKey).toBeTruthy();
  await expect(list.getByRole('status')).toHaveText(`Seleccionada: ${first.label}`);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await canvasState(page))?.selectedActivityKey).toBeNull();
});

test('a 390 px se navega y se selecciona, pero no hay modo edit', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { user, version } = await openPublished(page, request);
  // Con un borrador, en escritorio el Administrador editaría; en móvil, solo lectura (FR-010).
  await uploadVersion(page, user.accessToken, version.diagramId, 'grande-4000x3000.png');
  await page.reload();
  await imageReady(page);
  await expect(page.getByText(/Versión 2 · Borrador/)).toBeVisible();
  expect((await canvasState(page))?.mode).toBe('view');
  await expect(page.getByRole('complementary', { name: 'Editor de actividades' })).toHaveCount(0);

  // Seleccionar una zona tocándola.
  const target = fixtureActivities('grande-4000x3000.json')[0]!;
  const point = await toScreen(page, {
    x: (target.bbox.x + target.bbox.w / 2) * IMAGE.width,
    y: (target.bbox.y + target.bbox.h / 2) * IMAGE.height,
  });
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await canvasState(page))?.selectedActivityKey).toBeTruthy();
  await expect(page.getByText(target.label, { exact: true }).first()).toBeVisible();
});
