import { expectedIndicators } from '../../apps/api/scripts/seed-analytics';
import { seedTiendaDemo } from './dashboard';
import { login } from './diagrams';
import { expect, test } from './fixtures';

// US1 de la 007 (quickstart §1): el Administrador ve los indicadores de "Tienda demo", filtra y
// consulta el mapa de cobertura; un Participante no puede entrar.

test('el dashboard muestra los indicadores, filtra y abre una actividad del mapa', async ({
  page,
  clientIp,
}) => {
  test.setTimeout(90_000);
  const seeded = await seedTiendaDemo(clientIp);
  const expected = expectedIndicators(seeded);
  await login(page, seeded.admin);
  await page.goto(`/proyectos/${seeded.projectId}`);
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  const kpis = page.getByLabel('Indicadores clave');
  await expect(kpis.getByText('Detalles', { exact: true }).locator('..').locator('dd')).toHaveText(
    String(expected.totalDetails),
  );
  await expect(kpis.getByText('Participantes activos').locator('..').locator('dd')).toHaveText(
    String(expected.activeParticipants),
  );
  await expect(kpis.getByText('Actividades cubiertas').locator('..').locator('dd')).toHaveText(
    `${expected.coveredActivitiesPct} %`,
  );

  // La tabla alternativa de un gráfico coincide con lo sembrado.
  const byType = page.getByRole('figure', { name: 'Detalles por tipo' });
  await byType.getByText('Ver los datos en una tabla').click();
  await expect(byType.getByRole('row', { name: /^No funcional/ })).toContainText(
    String(expected.byType.non_functional),
  );
  await expect(byType.locator('canvas')).toBeVisible();

  // Filtro por tipo: todo se recalcula.
  await page
    .getByRole('form', { name: 'Filtros' })
    .getByLabel('Tipo')
    .selectOption('non_functional');
  await expect(kpis.getByText('Detalles', { exact: true }).locator('..').locator('dd')).toHaveText(
    String(expected.byType.non_functional),
  );

  // Mapa de cobertura: una actividad con detalles muestra sus indicadores y el enlace.
  const map = page.getByRole('region', { name: 'Mapa de cobertura' });
  await map.getByRole('button', { name: /^Validar pago: \d+ detalles?$/ }).click();
  await expect(map.getByRole('status')).toContainText('Validar pago');
  await expect(map.getByRole('link', { name: 'Ver sus requisitos en el diagrama' })).toBeVisible();
  // Captura para la revisión visual, con las transiciones de los gráficos terminadas.
  await page.waitForTimeout(800);
  await page.screenshot({ path: test.info().outputPath('dashboard.png'), fullPage: true });
});

test('un Participante no puede abrir el dashboard', async ({ page, clientIp }) => {
  test.setTimeout(90_000);
  const seeded = await seedTiendaDemo(clientIp);
  await login(page, seeded.participants[0]!);
  await page.goto(`/proyectos/${seeded.projectId}`);
  await expect(page.getByRole('link', { name: 'Diagramas' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  await page.goto(`/proyectos/${seeded.projectId}/dashboard`);
  await expect(page.getByRole('heading', { name: 'Acceso denegado' })).toBeVisible();
  const response = await page.request.get(
    `/api/projects/${seeded.projectId}/dashboard/descriptive`,
    { headers: { authorization: `Bearer ${seeded.participants[0]!.accessToken}` } },
  );
  expect(response.status()).toBe(403);
});
