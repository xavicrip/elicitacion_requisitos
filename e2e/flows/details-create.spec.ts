import type { Page } from '@playwright/test';
import { canvasState, imageReady, login, toScreen } from './diagrams';
import { projectWithPublishedDiagram, registerTeam, type PublishedDiagram } from './details';
import { expect, test } from './fixtures';

// US1: registrar un detalle en una actividad (quickstart §1). Solo contra el stack local.

const IMAGE = { width: 900, height: 1200 };

/** Abre el diagrama y selecciona una actividad haciendo clic en su zona. */
async function selectActivity(page: Page, diagram: PublishedDiagram, label: string) {
  await page.goto(`/proyectos/${diagram.projectId}/diagramas/${diagram.diagramId}`);
  await imageReady(page);
  const { bbox } = diagram.activities.get(label)!;
  const point = await toScreen(page, {
    x: (bbox.x + bbox.w / 2) * IMAGE.width,
    y: (bbox.y + bbox.h / 2) * IMAGE.height,
  });
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await canvasState(page))?.selectedActivityKey)
    .toBe(diagram.activities.get(label)!.key);
  const panel = page.getByRole('complementary', { name: 'Requisitos' });
  await expect(panel.getByRole('heading', { name: `Requisitos de «${label}»` })).toBeVisible();
  return panel;
}

test('un Participante registra un detalle en "Validar pago" y lo ve al recargar', async ({
  page,
  request,
}) => {
  const { admin, luis } = await registerTeam(request);
  await login(page, admin);
  const diagram = await projectWithPublishedDiagram(page, admin, [luis]);
  await page.context().clearCookies();
  await login(page, luis);

  const panel = await selectActivity(page, diagram, 'Validar pago');
  await panel.getByLabel('Dado (contexto)').fill('el cliente tiene productos en el carrito');
  await panel.getByLabel('Cuando (acción)').fill('paga con tarjeta');
  await panel
    .getByLabel('Entonces (resultado)')
    .fill('el sistema confirma el pago en menos de 5 segundos');
  await panel.getByLabel('Tipo').selectOption({ label: 'No funcional' });
  await panel.getByRole('button', { name: 'Guardar requisito' }).click();

  const card = panel.getByRole('article');
  await expect(card).toContainText('Entonces el sistema confirma el pago en menos de 5 segundos');
  await expect(card).toContainText(luis.name);

  const reloaded = await selectActivity(page, diagram, 'Validar pago');
  await expect(reloaded.getByRole('article')).toContainText(luis.name);
});

test('sin "Entonces" no se puede guardar y se indica el campo', async ({ page, request }) => {
  const { admin, luis } = await registerTeam(request);
  await login(page, admin);
  const diagram = await projectWithPublishedDiagram(page, admin, [luis]);
  await page.context().clearCookies();
  await login(page, luis);

  const panel = await selectActivity(page, diagram, 'Validar pago');
  await panel.getByLabel('Dado (contexto)').fill('el cliente tiene productos en el carrito');
  await panel.getByLabel('Cuando (acción)').fill('paga con tarjeta');
  await panel.getByRole('button', { name: 'Guardar requisito' }).click();
  await expect(
    panel.getByText('Escribe el resultado (Entonces): al menos 5 caracteres.'),
  ).toBeVisible();
  await expect(panel.getByRole('article')).toHaveCount(0);
});

test('en un proyecto cerrado se ven los detalles pero no hay formulario', async ({
  page,
  request,
}) => {
  const { admin, luis } = await registerTeam(request);
  await login(page, admin);
  const diagram = await projectWithPublishedDiagram(page, admin, [luis]);
  const headers = { authorization: `Bearer ${admin.accessToken}` };
  await page.request.post(
    `/api/diagrams/${diagram.diagramId}/activities/${diagram.activities.get('Validar pago')!.key}/details`,
    {
      headers,
      data: {
        given: 'el cliente tiene productos',
        when: 'paga con tarjeta',
        then: 'confirma el pago',
        type: 'functional',
      },
    },
  );
  await page.request.post(`/api/projects/${diagram.projectId}/status`, {
    headers,
    data: { action: 'close' },
  });
  await page.context().clearCookies();
  await login(page, luis);

  const panel = await selectActivity(page, diagram, 'Validar pago');
  await expect(panel.getByRole('article')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Guardar requisito' })).toHaveCount(0);
});
