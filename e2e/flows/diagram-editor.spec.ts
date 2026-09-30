import type { Page } from '@playwright/test';
import {
  canvasState,
  dragOnImage,
  fixtureActivities,
  imageReady,
  login,
  openProject,
  uploadDiagram,
} from './diagrams';
import { expect, test } from './fixtures';
import { registerUser } from './helpers';

// US2: marcar actividades (quickstart §2). Solo contra el stack local, con E2E_HOOKS=true.

const IMAGE = { width: 900, height: 1200 };
const TYPE_LABEL: Record<string, string> = {
  action: 'Acción',
  decision: 'Decisión',
  start: 'Inicio',
  end: 'Fin',
};

const panel = (page: Page) => page.getByRole('complementary', { name: 'Editor de actividades' });

async function openWorkspace(page: Page, projectId: string, diagramId: string) {
  await page.goto(`/proyectos/${projectId}/diagramas/${diagramId}`);
  await imageReady(page);
  expect((await canvasState(page))?.mode).toBe('edit');
}

test('marcar 5 actividades con nombre y tipo, conectar dos y conservarlas al recargar', async ({
  page,
  request,
}) => {
  const user = await registerUser(request);
  await login(page, user);
  const projectId = await openProject(page, user.accessToken);
  const version = await uploadDiagram(page, user.accessToken, projectId);
  await openWorkspace(page, projectId, version.diagramId);

  const expected = fixtureActivities('compra-simple.json').slice(0, 5);
  for (const [index, activity] of expected.entries()) {
    const { x, y, w, h } = activity.bbox;
    await dragOnImage(
      page,
      { x: x * IMAGE.width, y: y * IMAGE.height },
      { x: (x + w) * IMAGE.width, y: (y + h) * IMAGE.height },
    );
    const name = panel(page).getByLabel('Nombre');
    await expect(name).toHaveValue(`Actividad ${index + 1}`);
    await name.fill(activity.label);
    await panel(page).getByLabel('Tipo').selectOption({ label: TYPE_LABEL[activity.type]! });
  }
  await expect(panel(page).getByRole('heading', { name: 'Actividades (5)' })).toBeVisible();

  // Conectar "Validar pago" → "Emitir factura" (FR-005).
  await panel(page)
    .getByRole('button', { name: /^Validar pago/ })
    .click();
  await panel(page)
    .getByRole('group', { name: 'Va a' })
    .getByRole('checkbox', { name: 'Emitir factura' })
    .check();
  await expect(panel(page).getByText('Guardado')).toBeVisible();

  // Guardado automático: al recargar se conserva todo.
  await page.reload();
  await imageReady(page);
  const response = await page.request.get(`/api/diagram-versions/${version.id}`, {
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  const saved = (await response.json()) as {
    activities: Array<{ key: string; label: string; type: string; next: string[] }>;
  };
  expect(saved.activities.map(({ label, type }) => ({ label, type }))).toEqual(
    expected.map(({ label, type }) => ({ label, type })),
  );
  const byLabel = new Map(saved.activities.map((activity) => [activity.label, activity]));
  expect(byLabel.get('Validar pago')?.next).toEqual([byLabel.get('Emitir factura')?.key]);
  await expect(panel(page).getByRole('heading', { name: 'Actividades (5)' })).toBeVisible();
});

test('dos pestañas de Administrador mueven la misma zona: la segunda ve el conflicto', async ({
  page,
  context,
  request,
}) => {
  const user = await registerUser(request);
  await login(page, user);
  const projectId = await openProject(page, user.accessToken);
  const version = await uploadDiagram(page, user.accessToken, projectId);
  await page.request.post(`/api/diagram-versions/${version.id}/activities`, {
    headers: { authorization: `Bearer ${user.accessToken}` },
    data: { label: 'Validar pago', type: 'decision', bbox: { x: 0.3, y: 0.3, w: 0.3, h: 0.1 } },
  });

  const second = await context.newPage();
  for (const tab of [page, second]) {
    await openWorkspace(tab, projectId, version.diagramId);
    await panel(tab)
      .getByRole('button', { name: /^Validar pago/ })
      .click();
  }

  // La primera pestaña mueve la zona y guarda.
  await page.bringToFront();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(panel(page).getByText('Guardado')).toBeVisible();

  // La segunda aún tiene el rev anterior: 409, aviso y recarga de la zona.
  await second.bringToFront();
  await second.keyboard.press('Shift+ArrowDown');
  await expect(panel(second).getByText('Otro administrador modificó esta actividad')).toBeVisible();
});
