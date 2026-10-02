import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openProject } from '../flows/diagrams';
import { startDetection, waitForDetection } from '../flows/detection';
import { expect, test } from '../flows/fixtures';
import { registerUser } from '../flows/helpers';

// T046 (006, SC-003 y plan ajuste 9): detección del diagrama de 50 actividades del conjunto de
// validación (`020.png`) en < 60 s y memoria máxima del worker < 400 MB. Solo contra Compose:
// `pnpm e2e:perf -g detección`. Los resultados se anotan en plan.md.

const DIAGRAM = fileURLToPath(
  new URL('../../apps/analytics/tests/fixtures/diagrams/020.png', import.meta.url),
);
const WORKER = process.env.DETECTION_WORKER_CONTAINER || 'reqcanvas-analytics-worker-1';

/** Memoria del contenedor en MB según `docker stats` (p. ej. «187.3MiB / 7.6GiB»). */
function workerMemoryMb(): number {
  const usage = execFileSync(
    'docker',
    ['stats', '--no-stream', '--format', '{{.MemUsage}}', WORKER],
    {
      encoding: 'utf8',
    },
  )
    .split('/')[0]!
    .trim();
  const value = Number.parseFloat(usage);
  if (usage.endsWith('GiB')) return value * 1024;
  if (usage.endsWith('KiB')) return value / 1024;
  return value;
}

test('detección de un diagrama de 50 actividades: tiempo y memoria del worker', async ({
  request,
}) => {
  // Solo la API: no hace falta navegador.
  const page = { request };
  test.skip(
    !existsSync(DIAGRAM),
    'Genera antes el conjunto: uv run python tests/fixtures/generate.py',
  );
  test.setTimeout(180_000);
  const ana = await registerUser(request);
  const projectId = await openProject(page, ana.accessToken);
  const upload = await page.request.post(`/api/projects/${projectId}/diagrams`, {
    headers: { authorization: `Bearer ${ana.accessToken}` },
    multipart: {
      name: 'Cincuenta actividades',
      file: { name: '020.png', mimeType: 'image/png', buffer: readFileSync(DIAGRAM) },
    },
  });
  expect(upload.status()).toBe(201);
  const versionId = ((await upload.json()) as { id: string }).id;

  const idle = workerMemoryMb();
  let peak = idle;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      peak = Math.max(peak, workerMemoryMb());
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();

  const started = Date.now();
  await startDetection(page, ana.accessToken, versionId);
  const job = await waitForDetection(page, ana.accessToken, versionId, 120_000);
  const seconds = (Date.now() - started) / 1000;
  sampling = false;
  await sampler;

  const proposals = (await (
    await page.request.get(`/api/diagram-versions/${versionId}/proposals`, {
      headers: { authorization: `Bearer ${ana.accessToken}` },
    })
  ).json()) as { activities: unknown[]; transitions: unknown[] };
  console.log(
    `detección 50 actividades: ${seconds.toFixed(1)} s · propuestas ${proposals.activities.length} ` +
      `· flechas ${proposals.transitions.length} · worker ${idle.toFixed(0)} MB en reposo, ` +
      `${peak.toFixed(0)} MB de pico`,
  );
  expect(job.status).toBe('done');
  expect(seconds).toBeLessThan(60);
  expect(peak).toBeLessThan(400);
});
