import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { Download, Page } from '@playwright/test';
import { seedTiendaDemo } from './dashboard';
import { login } from './diagrams';
import { expect, test } from './fixtures';

// US1 de la 008 (quickstart §1 y §4.2): el Administrador exporta los requisitos de "Tienda demo"
// a Excel y a CSV desde el dashboard, con los filtros activos; un Participante no puede.

/** Filas de datos de un CSV sin saltos de línea dentro de los campos (la semilla no los tiene). */
function csvRows(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const lines = text.slice(1).split('\r\n');
  expect(lines.at(-1)).toBe('');
  expect(lines[0]).toContain('"ID","Diagrama","Actividad","Dado","Cuando","Entonces"');
  return lines.slice(1, -1);
}

async function downloadFrom(page: Page, button: string): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('region', { name: 'Exportar' }).getByRole('button', { name: button }).click(),
  ]);
  return download;
}

test('exportar los requisitos a Excel y a CSV, con los filtros del dashboard', async ({
  page,
  clientIp,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedTiendaDemo(clientIp);
  const validated = seeded.details.filter((detail) => detail.status === 'validated').length;
  await login(page, seeded.admin);
  await page.goto(`/proyectos/${seeded.projectId}/dashboard`);
  await expect(page.getByRole('region', { name: 'Exportar' })).toBeVisible();

  const excel = await downloadFrom(page, 'Exportar a Excel');
  expect(excel.suggestedFilename()).toMatch(/^reqcanvas-tienda-demo-\d{8}-\d{4}\.xlsx$/);
  // Un .xlsx es un ZIP: empieza por «PK».
  expect(
    readFileSync(await excel.path())
      .subarray(0, 2)
      .toString(),
  ).toBe('PK');

  const csv = await downloadFrom(page, 'Exportar a CSV');
  expect(csv.suggestedFilename()).toMatch(/^reqcanvas-tienda-demo-\d{8}-\d{4}\.csv$/);
  const rows = csvRows(await csv.path());
  expect(rows).toHaveLength(seeded.details.length);
  expect(rows.some((row) => row.includes('"Validar pago"'))).toBe(true);

  // Solo los validados: se quita «Pendiente» en los filtros del dashboard.
  await page.getByRole('form', { name: 'Filtros' }).getByLabel('Pendiente').uncheck();
  const filtered = csvRows(await (await downloadFrom(page, 'Exportar a CSV')).path());
  expect(filtered).toHaveLength(validated);
  expect(filtered.every((row) => row.includes('"Validado"'))).toBe(true);

  // Las tres exportaciones quedan en el historial.
  const region = page.getByRole('region', { name: 'Exportar' });
  await region.getByRole('button', { name: 'Historial de exportaciones' }).click();
  await expect(
    region.getByRole('list', { name: 'Historial de exportaciones' }).getByRole('listitem'),
  ).toHaveCount(3);
  await page.screenshot({ path: test.info().outputPath('exportar.png'), fullPage: true });
});

/** Rutas de los archivos de un ZIP, leídas de su directorio central. */
function zipEntries(path: string): string[] {
  const zip = readFileSync(path);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let index = 0; index < total; index++) {
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    names.push(zip.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

// US2 de la 008 (quickstart §2): el ZIP lleva un `.feature` por actividad con detalles validados
// y aumenta con «Incluir pendientes».
test('exportar los requisitos validados a Gherkin', async ({ page, clientIp }) => {
  test.setTimeout(120_000);
  const seeded = await seedTiendaDemo(clientIp);
  const activities = (statuses: string[]) =>
    new Set(
      seeded.details
        .filter((detail) => statuses.includes(detail.status))
        .map((detail) => detail.activityKey),
    ).size;
  await login(page, seeded.admin);
  await page.goto(`/proyectos/${seeded.projectId}/dashboard`);
  const region = page.getByRole('region', { name: 'Exportar' });
  await expect(region).toBeVisible();

  const validated = await downloadFrom(page, 'Exportar a Gherkin');
  expect(validated.suggestedFilename()).toBe('reqcanvas-tienda-demo-gherkin.zip');
  const features = zipEntries(await validated.path());
  expect(features).toHaveLength(activities(['validated']));
  expect(features.every((name) => /^[a-z0-9-]+\/[a-z0-9-]+\.feature$/.test(name))).toBe(true);

  await region.getByLabel('Incluir pendientes').check();
  const all = zipEntries(await (await downloadFrom(page, 'Exportar a Gherkin')).path());
  expect(all).toHaveLength(activities(['validated', 'pending']));
  expect(all.length).toBeGreaterThan(features.length);
  expect(all).toEqual(expect.arrayContaining(features));
});

/** Páginas de un PDF: los objetos `/Type /Page`, también dentro de los flujos comprimidos. */
function pdfPages(path: string): number {
  const pdf = readFileSync(path);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const chunks = [pdf.toString('latin1')];
  for (const match of chunks[0]!.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = pdf.indexOf('endstream', start);
    try {
      chunks.push(inflateSync(pdf.subarray(start, end)).toString('latin1'));
    } catch {
      // No es un flujo comprimido con zlib (p. ej., una imagen).
    }
  }
  return chunks.join('\n').match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
}

// US3 de la 008 (quickstart §3): el reporte PDF se genera en segundo plano con el worker real
// (`analytics-worker`), se avisa cuando está listo y se descarga.
test('generar y descargar el reporte PDF', async ({ page, clientIp }) => {
  test.setTimeout(240_000);
  const seeded = await seedTiendaDemo(clientIp);
  await login(page, seeded.admin);
  await page.goto(`/proyectos/${seeded.projectId}/dashboard`);
  const region = page.getByRole('region', { name: 'Exportar' });
  await region.getByRole('button', { name: 'Generar reporte PDF' }).click();
  await expect(region.getByText('Generando el reporte PDF…')).toBeVisible();
  await expect(region.getByText('Tu exportación está lista.')).toBeVisible({ timeout: 150_000 });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    region.getByRole('button', { name: 'Descargar' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^reqcanvas-tienda-demo-\d{8}-\d{4}\.pdf$/);
  // Portada, resumen, diagramas, distribuciones, hallazgos y anexo.
  expect(pdfPages(await download.path())).toBeGreaterThanOrEqual(6);

  await region.getByRole('button', { name: 'Historial de exportaciones' }).click();
  await expect(
    region.getByRole('list', { name: 'Historial de exportaciones' }).getByRole('listitem'),
  ).toContainText(['Reporte PDF']);
});

test('un Participante no puede exportar', async ({ page, clientIp }) => {
  test.setTimeout(90_000);
  const seeded = await seedTiendaDemo(clientIp);
  const participant = seeded.participants[0]!;
  await login(page, participant);
  await page.goto(`/proyectos/${seeded.projectId}/dashboard`);
  await expect(page.getByRole('heading', { name: 'Acceso denegado' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Exportar' })).toHaveCount(0);
  const response = await page.request.post(`/api/projects/${seeded.projectId}/exports`, {
    headers: { authorization: `Bearer ${participant.accessToken}` },
    data: { format: 'csv' },
  });
  expect(response.status()).toBe(403);
});
