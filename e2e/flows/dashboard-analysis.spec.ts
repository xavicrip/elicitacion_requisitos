import { seedTiendaDemo } from './dashboard';
import { login } from './diagrams';
import { expect, test } from './fixtures';

// US2 de la 007 (quickstart §2): el Administrador ejecuta el análisis de "Tienda demo" con el
// worker real (modelos incluidos), ve el progreso y explora palabras clave, temas y grupos.
// Necesita `analysis-worker` (perfil `mining` de Compose).

test('ejecutar el análisis de texto y explorar sus resultados', async ({
  page,
  request,
  clientIp,
}) => {
  const health = await (await request.get('/api/health/deep')).json();
  test.skip(
    health.checks?.['analysis-worker']?.status !== 'up',
    'Levanta el worker de minería: pnpm dev:up:mining',
  );
  test.setTimeout(420_000);
  const seeded = await seedTiendaDemo(clientIp);
  await login(page, seeded.admin);
  await page.goto(`/proyectos/${seeded.projectId}/dashboard`);

  const analysis = page.getByRole('region', { name: 'Análisis de texto' });
  await expect(
    analysis.getByText('Aún no se ha ejecutado ningún análisis de este proyecto.'),
  ).toBeVisible();
  await analysis.getByRole('button', { name: 'Ejecutar análisis' }).click();
  await expect(analysis.getByRole('status').first()).toContainText(/Analizando|Análisis en cola/);

  // El primer análisis carga los modelos: puede tardar más de un minuto.
  await expect(analysis.getByRole('tablist', { name: 'Resultados del análisis' })).toBeVisible({
    timeout: 300_000,
  });
  await expect(analysis.getByText(/Último análisis: .* · 80 detalles/)).toBeVisible();

  // Palabras clave de "Validar pago": términos de pagos.
  const keywords = analysis.getByRole('tabpanel');
  await keywords.getByLabel('Actividad').selectOption({ label: 'Validar pago' });
  await expect(
    keywords.getByRole('list', { name: 'Términos distintivos de Validar pago' }),
  ).toContainText(/pago|tarjeta|pasarela/);

  // Temas: los de pagos y seguridad salen como temas distintos.
  await analysis.getByRole('tab', { name: 'Temas' }).click();
  const topics = analysis.getByRole('list', { name: 'Temas' });
  await expect(topics.getByRole('listitem', { name: /^Tema \d+$/ }).nth(1)).toBeVisible();
  await expect(topics).toContainText(/pago|tarjeta|pasarela/);
  await expect(topics).toContainText(/contraseña|sesión|cuenta/);

  // Grupos: al elegir uno se ven sus detalles.
  await analysis.getByRole('tab', { name: 'Grupos' }).click();
  await analysis.getByRole('button', { name: /^Grupo 1 · \d+ detalles$/ }).click();
  await expect(
    analysis.getByRole('region', { name: 'Detalles del grupo' }).getByRole('listitem').first(),
  ).toContainText('Dado');
  await analysis.getByRole('tab', { name: 'Nube de palabras' }).click();
  await expect(analysis.locator('canvas').first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: test.info().outputPath('analysis.png'), fullPage: true });

  // Calidad: los detalles con términos ambiguos aparecen primero, con su explicación (US3).
  await analysis.getByRole('tab', { name: 'Calidad' }).click();
  const worst = analysis
    .getByRole('list', { name: 'Detalles por calidad' })
    .getByRole('listitem')
    .first();
  await expect(worst).toContainText(/Puntaje \d+ de 100/);
  await expect(worst).toContainText('Término ambiguo');

  // Duplicados: confirmar un par marca el otro detalle como duplicado (moderación de la 004).
  const duplicatesTab = analysis.getByRole('tab', { name: /^Duplicados \(\d+\)$/ });
  const before = Number((await duplicatesTab.textContent())!.match(/\d+/)![0]);
  expect(before).toBeGreaterThanOrEqual(2);
  await duplicatesTab.click();
  const pair = analysis.getByRole('listitem', { name: 'Posible duplicado' }).first();
  await expect(pair).toContainText(/Similitud: \d+\s%/);
  await pair.getByRole('button', { name: 'Confirmar duplicado' }).click();
  await expect(analysis.getByRole('tab', { name: `Duplicados (${before - 1})` })).toBeVisible();
  const orphansOrDuplicates = await request.get(
    `/api/projects/${seeded.projectId}/dashboard/descriptive?status=pending&status=validated`,
    { headers: { authorization: `Bearer ${seeded.admin.accessToken}` } },
  );
  // El duplicado confirmado deja de contarse: 80 detalles menos uno.
  expect((await orphansOrDuplicates.json()).kpis.totalDetails).toBe(79);

  // Un detalle nuevo después del análisis: aviso de desactualizado (FR-014).
  const [activityKey] = [...seeded.activityKeys.values()];
  const created = await request.post(
    `/api/diagrams/${seeded.diagramId}/activities/${activityKey}/details`,
    {
      headers: { authorization: `Bearer ${seeded.admin.accessToken}` },
      data: {
        given: 'el cliente está en el catálogo',
        when: 'busca un producto por su nombre',
        then: 've los resultados en menos de 2 segundos',
        type: 'non_functional',
      },
    },
  );
  expect(created.status()).toBe(201);
  await page.reload();
  // El detalle nuevo y el que pasó a duplicado cambian los datos analizados.
  await expect(
    page.getByText(/Análisis desactualizado: \d+ detalles? nuevos? o modificados?/),
  ).toBeVisible();
});
