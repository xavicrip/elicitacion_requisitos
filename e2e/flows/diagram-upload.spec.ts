import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { registerUser, type TestUser } from './helpers';

// US1: subir un diagrama (quickstart §1). Solo contra el stack local, con E2E_HOOKS=true.

const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/diagrams/${name}`, import.meta.url));

declare global {
  interface Window {
    __canvasState?: { versionId: string; mode: string; imageStatus: string };
  }
}

async function login(page: Page, user: TestUser) {
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Mis proyectos' })).toBeVisible();
}

/** Proyecto abierto del usuario, creado por la API a través del proxy de web. */
async function openProject(page: Page, accessToken: string): Promise<string> {
  const headers = { authorization: `Bearer ${accessToken}` };
  const created = await page.request.post('/api/projects', {
    headers,
    data: { name: `Diagramas ${Date.now()}` },
  });
  const { id } = (await created.json()) as { id: string };
  await page.request.post(`/api/projects/${id}/status`, { headers, data: { action: 'open' } });
  return id;
}

async function startUpload(page: Page, projectId: string, name: string) {
  await page.goto(`/proyectos/${projectId}/diagramas`);
  await page.getByRole('button', { name: 'Nuevo diagrama' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo diagrama' });
  await dialog.getByLabel('Nombre').fill(name);
  return dialog;
}

const imageReady = (page: Page) =>
  expect.poll(() => page.evaluate(() => window.__canvasState?.imageStatus)).toBe('ready');

test('subir compra-simple.png abre el espacio de trabajo en borrador con la imagen', async ({
  page,
  request,
}) => {
  const user = await registerUser(request);
  await login(page, user);
  const projectId = await openProject(page, user.accessToken);

  const dialog = await startUpload(page, projectId, 'Proceso de compra');
  await dialog.getByLabel(/Imagen/).setInputFiles(fixture('compra-simple.png'));
  await dialog.getByRole('button', { name: 'Subir' }).click();

  await expect(page).toHaveURL(new RegExp(`/proyectos/${projectId}/diagramas/[0-9a-f]{24}$`));
  await expect(page.getByRole('heading', { name: 'Proceso de compra' })).toBeVisible();
  await expect(page.getByText('Versión 1 · Borrador')).toBeVisible();
  await imageReady(page);
  expect(await page.evaluate(() => window.__canvasState?.mode)).toBe('view');
});

test('un PDF y un archivo de 15 MB se rechazan con su mensaje', async ({ page, request }) => {
  const user = await registerUser(request);
  await login(page, user);
  const projectId = await openProject(page, user.accessToken);

  const dialog = await startUpload(page, projectId, 'No válido');
  const input = dialog.getByLabel(/Imagen/);
  await input.setInputFiles({
    name: 'doc.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n%%EOF'),
  });
  await dialog.getByRole('button', { name: 'Subir' }).click();
  await expect(dialog.getByText(/Formato no admitido/)).toBeVisible();

  await input.setInputFiles({
    name: 'enorme.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(15 * 1024 * 1024),
  });
  await dialog.getByRole('button', { name: 'Subir' }).click();
  await expect(dialog.getByText(/Máximo 10 MB/)).toBeVisible();
});

test('con-script.svg: el navegador solo descarga WebP, y al recargar la imagen sale de caché', async ({
  page,
  request,
}) => {
  const user = await registerUser(request);
  await login(page, user);
  const projectId = await openProject(page, user.accessToken);
  const images: Array<{ url: string; status: number; headers: Record<string, string> }> = [];
  page.on('response', (response) => {
    if (response.url().includes('/image/') || /\.svg($|\?)/.test(response.url())) {
      images.push({ url: response.url(), status: response.status(), headers: response.headers() });
    }
  });

  const dialog = await startUpload(page, projectId, 'SVG con script');
  await dialog.getByLabel(/Imagen/).setInputFiles(fixture('con-script.svg'));
  await dialog.getByRole('button', { name: 'Subir' }).click();
  await imageReady(page);

  const display = images.find((image) => image.url.endsWith('/image/display'));
  expect(display, 'se descarga la imagen display').toBeDefined();
  expect(images.every((image) => image.headers['content-type'] === 'image/webp')).toBe(true);
  expect(images.some((image) => image.url.endsWith('.svg'))).toBe(false);
  // A través del proxy de web: caché privada inmutable y el ETag intacto (sin recomprimir).
  expect(display!.headers['cache-control']).toBe('private, max-age=31536000, immutable');
  expect(display!.headers.etag).toMatch(/^"[^"]+"$/);

  await page.reload();
  await imageReady(page);
  const cached = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((entry) => entry.name.endsWith('/image/display'))
      .map((entry) => entry as PerformanceResourceTiming)
      .map(({ transferSize, encodedBodySize }) => ({ transferSize, encodedBodySize })),
  );
  expect(cached.length).toBeGreaterThan(0);
  // Servida desde la caché del navegador (0 bytes) o revalidada con un 304 (solo cabeceras).
  expect(cached.every((entry) => entry.transferSize < entry.encodedBodySize)).toBe(true);
});
