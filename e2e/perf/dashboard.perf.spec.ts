import type { APIRequestContext } from '@playwright/test';
import type { SeededProject } from '../../apps/api/scripts/seed-analytics';
import { waitForAnalysis } from '../flows/dashboard';
import { expect, test } from '../flows/fixtures';
import { containerMemoryMb, seedVolumeProject as seedProject } from './volume';

// T056 (007): dashboard descriptivo con 2 000 detalles en < 3 s (SC-001), análisis completo de
// 2 000 detalles en < 5 min (SC-002) y, como referencia del caso límite, 5 000 en < 12 min, con
// la memoria máxima de `analysis-worker`. Solo contra Compose con el perfil `mining`
// (`pnpm dev:up:mining` y `pnpm e2e:perf -g dashboard`). Los resultados se anotan en plan.md.
// El volumen se inserta con `./volume.ts`.

const WORKER = process.env.ANALYSIS_WORKER_CONTAINER || 'reqcanvas-analysis-worker-1';
const workerMemoryMb = () => containerMemoryMb(WORKER);

async function analyse(request: APIRequestContext, seeded: SeededProject, timeoutMs: number) {
  const headers = { authorization: `Bearer ${seeded.admin.accessToken}` };
  const idle = workerMemoryMb();
  let peak = idle;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      peak = Math.max(peak, workerMemoryMb());
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  })();
  const started = Date.now();
  const created = await request.post(`/api/projects/${seeded.projectId}/analysis-runs`, {
    headers,
    data: {},
  });
  expect(created.status(), await created.text()).toBe(202);
  const { id } = (await created.json()) as { id: string };
  const finished = await waitForAnalysis({ request }, seeded.admin.accessToken, id, timeoutMs);
  const seconds = (Date.now() - started) / 1000;
  sampling = false;
  await sampler;
  const run = (await (await request.get(`/api/analysis-runs/${id}`, { headers })).json()) as {
    detailCount: number;
    stages: Record<string, { status: string; durationMs?: number; reason?: string }>;
  };
  const stages = Object.entries(run.stages)
    .map(([name, stage]) =>
      stage.status === 'done'
        ? `${name} ${((stage.durationMs ?? 0) / 1000).toFixed(1)} s`
        : `${name} ${stage.status}${stage.reason ? ` (${stage.reason})` : ''}`,
    )
    .join(' · ');
  console.log(
    `análisis de ${run.detailCount} detalles: ${seconds.toFixed(1)} s · worker ` +
      `${idle.toFixed(0)} MB en reposo, ${peak.toFixed(0)} MB de pico\n  ${stages}`,
  );
  return { finished, seconds, peak, run };
}

test.beforeEach(async ({ request }) => {
  const health = await (await request.get('/api/health/deep')).json();
  test.skip(
    health.checks?.['analysis-worker']?.status !== 'up',
    'Levanta el worker de minería: pnpm dev:up:mining',
  );
});

test('dashboard con 2 000 detalles: descriptivo en < 3 s y análisis en < 5 min', async ({
  request,
  clientIp,
}) => {
  test.setTimeout(600_000);
  const seeded = await seedProject(clientIp, 2000);
  const headers = { authorization: `Bearer ${seeded.admin.accessToken}` };

  const times: number[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const started = Date.now();
    const response = await request.get(`/api/projects/${seeded.projectId}/dashboard/descriptive`, {
      headers,
    });
    times.push(Date.now() - started);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { kpis: { totalDetails: number } };
    expect(body.kpis.totalDetails).toBe(2000);
  }
  console.log(
    `descriptivo con 2 000 detalles: ${times.join(', ')} ms (máximo ${Math.max(...times)} ms)`,
  );
  expect(Math.max(...times)).toBeLessThan(3000);

  const { finished, seconds, run } = await analyse(request, seeded, 420_000);
  expect(finished.status).toBe('done');
  expect(finished.partial ?? false).toBe(false);
  expect(run.detailCount).toBe(2000);
  expect(seconds).toBeLessThan(300);
});

test('referencia del caso límite: análisis de 5 000 detalles en < 12 min', async ({
  request,
  clientIp,
}) => {
  test.setTimeout(900_000);
  const seeded = await seedProject(clientIp, 5000);
  const { finished, seconds, run } = await analyse(request, seeded, 780_000);
  expect(finished.status).toBe('done');
  expect(finished.partial ?? false).toBe(false);
  expect(run.detailCount).toBe(5000);
  expect(seconds).toBeLessThan(720);
});
