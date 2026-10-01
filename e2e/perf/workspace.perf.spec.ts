import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { imageReady, login, openProject, publishFixture, toScreen } from '../flows/diagrams';
import { expect, test } from '../flows/fixtures';
import { registerUser } from '../flows/helpers';

// T056: mediciones de rendimiento de la 003 (SC-002, SC-003 y el procesamiento de 10 MB).
// Solo contra el stack local: `pnpm e2e --project perf`. Los resultados se anotan en plan.md.

type Sharp = (
  input: Buffer,
  options: { raw: { width: number; height: number; channels: 3 } },
) => { png: (options: { compressionLevel: number }) => { toBuffer: () => Promise<Buffer> } };
// sharp es dependencia de api; se carga desde allí, como scripts/fixtures/diagrams.mjs.
const sharp = createRequire(new URL('../../apps/api/package.json', import.meta.url))(
  'sharp',
) as Sharp;

type FrameStats = { fps: number; p95Ms: number; frames: number };

/** Cuenta los frames del navegador mientras `interact` mueve la vista. */
async function measureFrames(page: Page, interact: () => Promise<void>): Promise<FrameStats> {
  await page.evaluate(() => {
    const times: number[] = [];
    const w = window as unknown as { __frames: number[]; __measuring: boolean };
    w.__frames = times;
    w.__measuring = true;
    const tick = (time: number) => {
      times.push(time);
      if (w.__measuring) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await interact();
  const times = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __measuring: boolean };
    w.__measuring = false;
    return w.__frames;
  });
  const intervals = times.slice(1).map((time, i) => time - times[i]!);
  const sorted = [...intervals].sort((a, b) => a - b);
  const seconds = (times.at(-1)! - times[0]!) / 1000;
  return {
    fps: Math.round((intervals.length / seconds) * 10) / 10,
    p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)]! * 10) / 10,
    frames: intervals.length,
  };
}

test('FPS durante zoom y desplazamiento con 100 zonas (SC-002: ≥ 50)', async ({
  page,
  request,
}) => {
  const user = await registerUser(request);
  await login(page, user);
  const projectId = await openProject(page, user.accessToken);
  const version = await publishFixture(
    page,
    user.accessToken,
    projectId,
    'cien-actividades.png',
    'Cien actividades',
  );
  await page.goto(`/proyectos/${projectId}/diagramas/${version.diagramId}`);
  await imageReady(page);

  const middle = await toScreen(page, { x: 1500, y: 1000 });
  await page.mouse.move(middle.x, middle.y);
  const zoom = await measureFrames(page, async () => {
    for (let i = 0; i < 90; i++) {
      await page.mouse.wheel(0, i < 45 ? -120 : 120);
      await page.waitForTimeout(16);
    }
  });

  const pan = await measureFrames(page, async () => {
    await page.mouse.down();
    for (let i = 0; i < 120; i++) {
      await page.mouse.move(middle.x + 200 * Math.sin(i / 10), middle.y + 100 * Math.cos(i / 10));
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  });

  console.log(`[perf] zoom: ${JSON.stringify(zoom)} · desplazamiento: ${JSON.stringify(pan)}`);
  expect(zoom.fps).toBeGreaterThanOrEqual(50);
  expect(pan.fps).toBeGreaterThanOrEqual(50);
});

test('diagrama navegable con la red a 10 Mbps en menos de 3 s (SC-003)', async ({
  page,
  browser,
  request,
}) => {
  const user = await registerUser(request);
  await login(page, user);
  const projectId = await openProject(page, user.accessToken);
  const version = await publishFixture(
    page,
    user.accessToken,
    projectId,
    'cien-actividades.png',
    'Cien actividades',
  );

  // Navegador sin caché, con la sesión ya iniciada (cookie de refresco) y la red limitada.
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const cold = await context.newPage();
  const cdp = await context.newCDPSession(cold);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 20,
    downloadThroughput: (10 * 1024 * 1024) / 8,
    uploadThroughput: (10 * 1024 * 1024) / 8,
  });

  const started = Date.now();
  await cold.goto(`/proyectos/${projectId}/diagramas/${version.diagramId}`);
  await imageReady(cold);
  const seconds = (Date.now() - started) / 1000;
  const transferred = await cold.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .reduce((sum, entry) => sum + (entry as PerformanceResourceTiming).transferSize, 0),
  );
  console.log(
    `[perf] navegable en ${seconds.toFixed(2)} s con 10 Mbps (${(transferred / 1024).toFixed(0)} KiB transferidos)`,
  );
  expect(seconds).toBeLessThan(3);
  await context.close();
});

test('una imagen de 10 MB se procesa en menos de 5 s', async ({ page, request }) => {
  const user = await registerUser(request);
  await login(page, user);
  const projectId = await openProject(page, user.accessToken);

  // PNG de ruido sin comprimir, justo por debajo de 10 MB (no se guarda en git).
  const side = 1860;
  const raw = Buffer.alloc(side * side * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  const buffer = await sharp(raw, { raw: { width: side, height: side, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
  expect(buffer.length).toBeGreaterThan(9.5 * 1024 * 1024);
  expect(buffer.length).toBeLessThanOrEqual(10 * 1024 * 1024);

  const started = Date.now();
  const response = await page.request.post(`/api/projects/${projectId}/diagrams`, {
    headers: { authorization: `Bearer ${user.accessToken}` },
    multipart: { name: 'Diez megas', file: { name: 'diez.png', mimeType: 'image/png', buffer } },
  });
  const seconds = (Date.now() - started) / 1000;
  expect(response.status()).toBe(201);
  console.log(
    `[perf] ${(buffer.length / 1024 / 1024).toFixed(2)} MB subidos y procesados en ${seconds.toFixed(2)} s`,
  );
  expect(seconds).toBeLessThan(5);
});
