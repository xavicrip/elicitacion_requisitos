import type { APIRequestContext } from '@playwright/test';
import type { SeededProject } from '../../apps/api/scripts/seed-analytics';
import { expect, test } from '../flows/fixtures';
import { seedVolumeProject, withMemoryPeak } from './volume';

// T045 (008): CSV y Excel de 2 000 detalles listos en < 10 s (SC-001) y reporte PDF de 2 000
// detalles en < 2 min (SC-003), con la memoria máxima de `analytics-worker`; como referencia,
// 5 000 detalles. Solo contra Compose (`pnpm dev:up` y `pnpm e2e --project=perf exports`). Los resultados
// se anotan en plan.md.

const WORKER = process.env.ANALYTICS_WORKER_CONTAINER || 'reqcanvas-analytics-worker-1';

type Exported = { id: string; status: string; bytes: number | null; detailCount: number };

/** Solicita una exportación y espera a que esté lista; devuelve los segundos y el tamaño. */
async function exportAs(
  request: APIRequestContext,
  seeded: SeededProject,
  format: 'csv' | 'xlsx' | 'gherkin' | 'pdf',
  timeoutMs: number,
) {
  const headers = { authorization: `Bearer ${seeded.admin.accessToken}` };
  const started = Date.now();
  const created = await request.post(`/api/projects/${seeded.projectId}/exports`, {
    headers,
    data: { format, options: { includePending: true } },
  });
  expect(created.status(), await created.text()).toBe(202);
  let exported = (await created.json()) as Exported;
  while (exported.status === 'pending' || exported.status === 'running') {
    expect(Date.now() - started, `${format} sin terminar`).toBeLessThan(timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, 200));
    exported = (await (
      await request.get(`/api/exports/${exported.id}`, { headers })
    ).json()) as Exported;
  }
  const seconds = (Date.now() - started) / 1000;
  expect(exported.status).toBe('done');
  const file = await request.get(`/api/exports/${exported.id}/download`, { headers });
  expect(file.status()).toBe(200);
  expect((await file.body()).length).toBe(exported.bytes);
  return { seconds, exported };
}

async function measure(request: APIRequestContext, seeded: SeededProject, total: number) {
  const seconds: Record<string, number> = {};
  for (const format of ['csv', 'xlsx', 'gherkin'] as const) {
    const { seconds: took, exported } = await exportAs(request, seeded, format, 120_000);
    expect(exported.detailCount).toBe(total);
    seconds[format] = took;
    console.log(
      `${format} de ${total} detalles: ${took.toFixed(1)} s · ` +
        `${((exported.bytes ?? 0) / 1024).toFixed(0)} KB`,
    );
  }
  const pdf = await withMemoryPeak(WORKER, () => exportAs(request, seeded, 'pdf', 330_000));
  seconds.pdf = pdf.result.seconds;
  console.log(
    `pdf de ${total} detalles: ${pdf.result.seconds.toFixed(1)} s · ` +
      `${((pdf.result.exported.bytes ?? 0) / 1024).toFixed(0)} KB · worker ` +
      `${pdf.idle.toFixed(0)} MB en reposo, ${pdf.peak().toFixed(0)} MB de pico`,
  );
  return seconds;
}

test.beforeEach(async ({ request }) => {
  const health = await (await request.get('/api/health/deep')).json();
  test.skip(health.checks?.['export-worker']?.status !== 'up', 'Levanta el stack: pnpm dev:up');
});

test('2 000 detalles: CSV y Excel en < 10 s y reporte PDF en < 2 min', async ({
  request,
  clientIp,
}) => {
  test.setTimeout(600_000);
  const seeded = await seedVolumeProject(clientIp, 2000);
  const seconds = await measure(request, seeded, 2000);
  expect(seconds.csv).toBeLessThan(10);
  expect(seconds.xlsx).toBeLessThan(10);
  expect(seconds.pdf).toBeLessThan(120);
});

test('referencia: exportaciones de 5 000 detalles', async ({ request, clientIp }) => {
  test.setTimeout(900_000);
  const seeded = await seedVolumeProject(clientIp, 5000);
  await measure(request, seeded, 5000);
});
