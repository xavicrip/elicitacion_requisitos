import { expect, test } from '@playwright/test';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const EXPECTED_VERSION = process.env.EXPECTED_VERSION;

test('la página inicial muestra ReqCanvas y la versión', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ReqCanvas' })).toBeVisible();
  await expect(page.getByText(/^v\S+$/)).toBeVisible();
  if (EXPECTED_VERSION) await expect(page.getByText(`v${EXPECTED_VERSION}`)).toBeVisible();
});

test('web /health responde 200', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ok', service: 'web' });
});

test('api /health/deep responde 200 con mongo, redis y analytics arriba', async ({ request }) => {
  const response = await request.get(`${API_URL}/health/deep`, {
    headers: { 'x-request-id': `smoke-${Date.now()}` },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe('ok');
  for (const dependency of ['mongo', 'redis', 'analytics']) {
    expect(body.checks[dependency]?.status, dependency).toBe('up');
  }
});

test('api /version coincide con la versión esperada', async ({ request }) => {
  const body = await (await request.get(`${API_URL}/version`)).json();
  expect(body.service).toBe('api');
  if (EXPECTED_VERSION) expect(body.version).toBe(EXPECTED_VERSION);
});

test('api /health responde con p95 < 200 ms (50 peticiones)', async ({ request }) => {
  const durations: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    const started = performance.now();
    const response = await request.get(`${API_URL}/health`);
    durations.push(performance.now() - started);
    expect(response.status()).toBe(200);
  }
  durations.sort((a, b) => a - b);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? Infinity;
  console.log(`api /health p95 = ${p95.toFixed(1)} ms`);
  expect(p95).toBeLessThan(Number(process.env.HEALTH_P95_MS ?? 200));
});
