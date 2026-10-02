import type { Page } from '@playwright/test';
import { seedAnalyticsProject } from '../../apps/api/scripts/seed-analytics';
import { expect } from './fixtures';

// Helpers del dashboard analítico (feature 007): el proyecto "Tienda demo" sembrado por la API
// y la espera a que un análisis termine.

const baseURL = () => process.env.BASE_URL || 'http://localhost:5173';

/**
 * "Tienda demo": 6 personas, 10 actividades y 80 detalles del conjunto de validación, por el
 * proxy de web y con la IP de la prueba (el rate limit de /auth es por IP).
 */
export const seedTiendaDemo = (clientIp: string) =>
  seedAnalyticsProject(`${baseURL()}/api`, { 'x-real-ip': clientIp });

export type AnalysisRun = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  partial?: boolean;
  error?: { code: string; message: string } | null;
};

/** Espera a que el run termine (`done` o `failed`) y lo devuelve. */
export async function waitForAnalysis(
  page: Pick<Page, 'request'>,
  accessToken: string,
  runId: string,
  timeoutMs = 300_000,
) {
  let run: AnalysisRun | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/analysis-runs/${runId}`, {
          headers: { authorization: `Bearer ${accessToken}` },
        });
        run = (await response.json()) as AnalysisRun;
        return run.status;
      },
      { timeout: timeoutMs, intervals: [1000, 2000, 5000] },
    )
    .toMatch(/^(done|failed)$/);
  return run!;
}
