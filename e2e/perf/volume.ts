import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import type { SeededProject } from '../../apps/api/scripts/seed-analytics';
import { seedTiendaDemo } from '../flows/dashboard';

// Volumen para las mediciones de la 007 y la 008. Crear miles de detalles por la API tardaría
// más que la medición (60 escrituras por minuto y usuario), así que se insertan en MongoDB con
// `mongosh` dentro de su contenedor.

const MONGO = process.env.MONGO_CONTAINER || 'reqcanvas-mongodb-1';
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

/** Memoria de un contenedor en MB según `docker stats` (p. ej. «1.9GiB / 7.6GiB»). */
export function containerMemoryMb(container: string): number {
  const usage = execFileSync(
    'docker',
    ['stats', '--no-stream', '--format', '{{.MemUsage}}', container],
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

/** «Tienda demo» ampliado hasta `total` detalles. */
export async function seedVolumeProject(clientIp: string, total: number) {
  const seeded = await seedTiendaDemo(clientIp);
  insertDetails(seeded, total - seeded.details.length);
  return seeded;
}

/** Muestrea la memoria de un contenedor cada segundo mientras se ejecuta `run`. */
export async function withMemoryPeak<T>(container: string, run: () => Promise<T>) {
  const idle = containerMemoryMb(container);
  let peak = idle;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      peak = Math.max(peak, containerMemoryMb(container));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  })();
  try {
    return { result: await run(), idle, peak: () => peak };
  } finally {
    sampling = false;
    await sampler;
  }
}
