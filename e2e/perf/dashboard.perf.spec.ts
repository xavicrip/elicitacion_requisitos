import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext } from '@playwright/test';
import type { SeededProject } from '../../apps/api/scripts/seed-analytics';
import { seedTiendaDemo, waitForAnalysis } from '../flows/dashboard';
import { expect, test } from '../flows/fixtures';

// T056 (007): dashboard descriptivo con 2 000 detalles en < 3 s (SC-001), análisis completo de
// 2 000 detalles en < 5 min (SC-002) y, como referencia del caso límite, 5 000 en < 12 min, con
// la memoria máxima de `analysis-worker`. Solo contra Compose con el perfil `mining`
// (`pnpm dev:up:mining` y `pnpm e2e:perf -g dashboard`). Los resultados se anotan en plan.md.
//
// Crear miles de detalles por la API tardaría más que la medición (60 escrituras por minuto y
// usuario), así que el volumen se inserta en MongoDB con `mongosh` dentro de su contenedor.

const MONGO = process.env.MONGO_CONTAINER || 'reqcanvas-mongodb-1';
const WORKER = process.env.ANALYSIS_WORKER_CONTAINER || 'reqcanvas-analysis-worker-1';
const VALIDATION = fileURLToPath(
  new URL('../../apps/analytics/tests/fixtures/details/validation.json', import.meta.url),
);

type Part = { activityKey: string; given: string; when: string; then: string };
type Template = Part & {
  type: string;
  priority: string | null;
  authorRole: string;
  tags: string[];
};

/** Memoria del contenedor en MB según `docker stats` (p. ej. «1.9GiB / 7.6GiB»). */
function workerMemoryMb(): number {
  const usage = execFileSync(
    'docker',
    ['stats', '--no-stream', '--format', '{{.MemUsage}}', WORKER],
    { encoding: 'utf8' },
  )
    .split('/')[0]!
    .trim();
  const value = Number.parseFloat(usage);
  if (usage.endsWith('GiB')) return value * 1024;
  if (usage.endsWith('KiB')) return value / 1024;
  return value;
}

/**
 * Detalles distintos a partir del conjunto de validación: el Dado, el Cuando y el Entonces se
 * toman de tres detalles diferentes de la misma actividad, con lo que el vocabulario y los temas
 * son los reales sin repetir textos.
 */
function volume(seeded: SeededProject, count: number) {
  const { input } = JSON.parse(readFileSync(VALIDATION, 'utf8')) as {
    input: { details: Template[] };
  };
  const byActivity = new Map<string, Template[]>();
  for (const detail of input.details) {
    byActivity.set(detail.activityKey, [...(byActivity.get(detail.activityKey) ?? []), detail]);
  }
  const groups = [...byActivity.entries()].filter(([, details]) => details.length >= 5);
  const people = [seeded.admin, ...seeded.participants];
  return Array.from({ length: count }, (_, index) => {
    const [activityKey, details] = groups[index % groups.length]!;
    const turn = Math.floor(index / groups.length);
    const pick = (stride: number, offset: number) =>
      details[(turn * stride + offset) % details.length]!;
    const base = pick(1, 0);
    return {
      activityKey: seeded.activityKeys.get(activityKey)!,
      given: base.given,
      when: pick(3, 1).when,
      then: pick(7, 2).then,
      type: base.type,
      priority: base.priority,
      authorRole: base.authorRole,
      tags: base.tags,
      status: index % 4 === 0 ? 'validated' : 'pending',
      voteCount: index % 5,
      commentCount: index % 3,
      authorId: people[index % people.length]!.id,
      daysAgo: index % 30,
    };
  });
}

function insertDetails(seeded: SeededProject, count: number) {
  const script = `
    const docs = ${JSON.stringify(volume(seeded, count))};
    const project = ObjectId('${seeded.projectId}');
    const diagram = ObjectId('${seeded.diagramId}');
    const now = Date.now();
    const result = db.details.insertMany(docs.map(({ daysAgo, authorId, ...doc }) => {
      const at = new Date(now - daysAgo * 86400000);
      return { ...doc, projectId: project, diagramId: diagram, authorId: ObjectId(authorId),
        duplicateOf: null, discardReason: null, rev: 0, createdAt: at, updatedAt: at };
    }));
    print(Object.keys(result.insertedIds).length);
  `;
  const inserted = execFileSync(
    'docker',
    ['exec', '-i', MONGO, 'mongosh', 'reqcanvas', '--quiet', '--file', '/dev/stdin'],
    {
      input: script,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  expect(inserted.trim().split('\n').pop()).toBe(String(count));
}

async function seedProject(clientIp: string, total: number) {
  const seeded = await seedTiendaDemo(clientIp);
  insertDetails(seeded, total - seeded.details.length);
  return seeded;
}

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
