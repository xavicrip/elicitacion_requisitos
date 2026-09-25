import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests contra un entorno ya levantado: local (Docker Compose), staging o producción.
 * BASE_URL = web; API_URL = api (pública). analytics se verifica a través de api /health/deep.
 */
export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
