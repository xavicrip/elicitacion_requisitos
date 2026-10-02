import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { imageReady, login, openProject, publishFixture, toScreen } from '../flows/diagrams';
import { expect, test } from '../flows/fixtures';
import { registerUser } from '../flows/helpers';
import { measureNavigation } from './frames';

// T056 (003) y T034 (004): mediciones de rendimiento (SC-002, SC-003, 10 MB e indicadores).
// Solo contra el stack local: `pnpm e2e --project perf`. Los resultados se anotan en plan.md.

type Sharp = (
  input: Buffer,
  options: { raw: { width: number; height: number; channels: 3 } },
) => { png: (options: { compressionLevel: number }) => { toBuffer: () => Promise<Buffer> } };
// sharp es dependencia de api; se carga desde allí, como scripts/fixtures/diagrams.mjs.
const sharp = createRequire(new URL('../../apps/api/package.json', import.meta.url))(
  'sharp',
) as Sharp;

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

  const { zoom, pan } = await measureNavigation(page);
  console.log(`[perf] zoom: ${JSON.stringify(zoom)} · desplazamiento: ${JSON.stringify(pan)}`);
  expect(zoom.fps).toBeGreaterThanOrEqual(50);
  expect(pan.fps).toBeGreaterThanOrEqual(50);
});

test('FPS con los indicadores y el mapa de calor de la 004 (plan de la 004, ajuste 9)', async ({
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
  const headers = { authorization: `Bearer ${user.accessToken}` };
  const activities = (
    (await (await page.request.get(`/api/diagram-versions/${version.id}`, { headers })).json()) as {
      activities: Array<{ key: string }>;
    }
  ).activities;
  // Detalles en la mitad de las zonas (por debajo del límite de 60 escrituras por minuto):
  // 50 contadores y 50 marcas «Sin detalles», todos como DOM sobre el canvas.
  for (const { key } of activities.slice(0, 50)) {
    const created = await page.request.post(
      `/api/diagrams/${version.diagramId}/activities/${key}/details`,
      {
        headers,
        data: {
          given: 'el cliente tiene productos',
          when: 'paga con tarjeta',
          then: 'el sistema confirma el pago',
          type: 'functional',
        },
      },
    );
    expect(created.status()).toBe(201);
  }
  await page.goto(`/proyectos/${projectId}/diagramas/${version.diagramId}`);
  await imageReady(page);
  await expect(page.getByRole('main').getByText('Sin detalles')).toHaveCount(50);
  await page.getByRole('button', { name: 'Mapa de calor' }).click();

  const { zoom, pan } = await measureNavigation(page);
  console.log(
    `[perf] con indicadores · zoom: ${JSON.stringify(zoom)} · desplazamiento: ${JSON.stringify(pan)}`,
  );
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
    // PERF_LATENCY_MS simula la latencia de un entorno remoto (staging: ~170 ms por petición).
    latency: Number(process.env.PERF_LATENCY_MS ?? 20),
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

/**
 * Inserta detalles directamente en el MongoDB del stack de Compose: por la API serían demasiado
 * lentos (60 escrituras por minuto y usuario). Solo para estas mediciones locales.
 */
function seedDetails(docs: {
  projectId: string;
  diagramId: string;
  authorId: string;
  keys: string[];
}) {
  const script = `
    const project = ObjectId('${docs.projectId}');
    const diagram = ObjectId('${docs.diagramId}');
    const author = ObjectId('${docs.authorId}');
    const keys = ${JSON.stringify(docs.keys)};
    const now = new Date();
    db.details.insertMany(keys.map((key, i) => ({
      projectId: project, diagramId: diagram, activityKey: key,
      given: 'el cliente tiene productos en el carrito número ' + i,
      when: 'paga con tarjeta', then: 'el sistema confirma el pago ' + i,
      type: 'functional', priority: null, authorRole: null, tags: [], status: 'pending',
      duplicateOf: null, discardReason: null, voteCount: i % 7, commentCount: 0,
      authorId: author, rev: 0, createdAt: now, updatedAt: now,
    })));
  `;
  // Por la entrada estándar: el script (5 000 claves) excede el límite de argumentos.
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      'infra/docker-compose.yml',
      'exec',
      '-T',
      'mongodb',
      'mongosh',
      '--quiet',
      'reqcanvas',
    ],
    { cwd: fileURLToPath(new URL('../../', import.meta.url)), input: script, stdio: 'pipe' },
  );
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
};

test('panel de una actividad con 200 detalles (< 1 s, SC-003 de la 004) y cobertura de 5 000 (< 200 ms p95)', async ({
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
  const headers = { authorization: `Bearer ${user.accessToken}` };
  const { activities } = (await (
    await page.request.get(`/api/diagram-versions/${version.id}`, { headers })
  ).json()) as {
    activities: Array<{ key: string; bbox: { x: number; y: number; w: number; h: number } }>;
  };
  const me = (await (await page.request.get('/api/me', { headers })).json()) as { id: string };
  // 200 en la primera actividad y 4 800 repartidos entre las otras 99: 5 000 en total.
  const keys = [
    ...Array.from({ length: 200 }, () => activities[0]!.key),
    ...Array.from({ length: 4800 }, (_, i) => activities[1 + (i % 99)]!.key),
  ];
  seedDetails({ projectId, diagramId: version.diagramId, authorId: me.id, keys });

  // Cobertura: 20 peticiones a través del proxy de web.
  const durations: number[] = [];
  for (let i = 0; i < 20; i++) {
    const started = performance.now();
    const response = await page.request.get(`/api/diagram-versions/${version.id}/coverage`, {
      headers,
    });
    expect(response.status()).toBe(200);
    durations.push(performance.now() - started);
  }
  const p95 = Math.round(percentile(durations, 0.95));

  // Panel: desde el clic en la zona hasta ver los 200 detalles.
  await page.goto(`/proyectos/${projectId}/diagramas/${version.diagramId}`);
  await imageReady(page);
  const { bbox } = activities[0]!;
  const point = await toScreen(page, {
    x: (bbox.x + bbox.w / 2) * 3000,
    y: (bbox.y + bbox.h / 2) * 2000,
  });
  const started = Date.now();
  await page.mouse.click(point.x, point.y);
  const panel = page.getByRole('complementary', { name: 'Requisitos' });
  await expect(panel.getByRole('article')).toHaveCount(200, { timeout: 10_000 });
  const panelSeconds = (Date.now() - started) / 1000;

  console.log(
    `[perf] cobertura de 5 000 detalles: p95 ${p95} ms · panel con 200 detalles: ${panelSeconds.toFixed(2)} s`,
  );
  expect(p95).toBeLessThan(200);
  expect(panelSeconds).toBeLessThan(1);
});
