import { defineConfig, devices } from '@playwright/test';

/**
 * E2E contra un entorno ya levantado: local (Docker Compose), staging o producción.
 * BASE_URL = web; API_URL = api (pública). analytics se verifica a través de api /health/deep.
 *
 * Dos proyectos (plan de la 002, ajuste 4):
 * - `smoke`: solo lectura; es el único que corre tras cada despliegue (`--project smoke`).
 * - `flows`: registro, proyectos, invitaciones… Crean datos, así que solo existen contra el
 *   stack local o el del CI: con un BASE_URL remoto el proyecto ni siquiera se define.
 */
const baseURL = process.env.BASE_URL || 'http://localhost:5173';
const isLocal = ['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname);

const chrome = { ...devices['Desktop Chrome'] };

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'smoke', testMatch: 'smoke.spec.ts', use: chrome },
    ...(isLocal ? [{ name: 'flows', testMatch: 'flows/**/*.spec.ts', use: chrome }] : []),
  ],
});
