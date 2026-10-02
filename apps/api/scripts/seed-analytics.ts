/**
 * Proyecto "Tienda demo" para el dashboard analítico (feature 007, T005), creado por la API
 * pública: 6 personas (una Administradora y 5 Participantes), un diagrama publicado de 10
 * actividades y 80 detalles tomados del conjunto de validación de `analytics` (3 temas, 5
 * ambiguos y 3 pares de casi duplicados), con votos, comentarios y algunos validados.
 *
 * Uso: `pnpm --filter @reqcanvas/api seed:analytics [--api http://localhost:3000] [--print-expected]`.
 * Los E2E importan `seedAnalyticsProject` con su propia URL.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../../', import.meta.url);
const VALIDATION = fileURLToPath(
  new URL('apps/analytics/tests/fixtures/details/validation.json', ROOT),
);
const IMAGE = fileURLToPath(new URL('e2e/fixtures/diagrams/cien-actividades.png', ROOT));
const BOXES = fileURLToPath(new URL('e2e/fixtures/diagrams/cien-actividades.json', ROOT));

type ValidationDetail = {
  id: string;
  activityKey: string;
  given: string;
  when: string;
  then: string;
  type: 'functional' | 'non_functional' | 'business_rule' | 'constraint';
  priority: 'must' | 'should' | 'could' | 'wont' | null;
  authorRole: string;
  tags: string[];
  status: 'pending' | 'validated';
  voteCount: number;
  commentCount: number;
};
type Validation = {
  input: { activities: Array<{ key: string; label: string }>; details: ValidationDetail[] };
  truth: { duplicatePairs: string[][]; ambiguous: Record<string, string[]>; cold: string[] };
};
type Person = { name: string; email: string; password: string; accessToken: string; id: string };

export type SeededDetail = ValidationDetail & { apiId: string; authorIndex: number };
export type SeededProject = {
  projectId: string;
  diagramId: string;
  versionId: string;
  admin: Person;
  participants: Person[];
  /** Clave de la actividad en la API, por la del conjunto de validación (`act-01`…). */
  activityKeys: Map<string, string>;
  details: SeededDetail[];
};

/**
 * Los 80 detalles: los 3 primeros pares de duplicados, 5 ambiguos y el resto en orden, sin
 * detalles en la última actividad fría y con uno en la otra (como el conjunto completo).
 */
export function pickDetails(validation: Validation, total = 80): ValidationDetail[] {
  const byId = new Map(validation.input.details.map((detail) => [detail.id, detail]));
  const chosen = new Map<string, ValidationDetail>();
  for (const pair of validation.truth.duplicatePairs.slice(0, 3)) {
    for (const id of pair) chosen.set(id, byId.get(id)!);
  }
  for (const id of Object.keys(validation.truth.ambiguous).slice(0, 5)) {
    chosen.set(id, byId.get(id)!);
  }
  for (const detail of validation.input.details) {
    if (chosen.size >= total) break;
    chosen.set(detail.id, detail);
  }
  return [...chosen.values()];
}

/** Indicadores que el dashboard descriptivo debe mostrar para lo sembrado (`--print-expected`). */
export function expectedIndicators(seeded: Pick<SeededProject, 'details' | 'activityKeys'>) {
  const count = <K extends string>(key: (detail: SeededDetail) => K) =>
    seeded.details.reduce<Record<string, number>>((acc, detail) => {
      acc[key(detail)] = (acc[key(detail)] ?? 0) + 1;
      return acc;
    }, {});
  const covered = new Set(seeded.details.map((detail) => detail.activityKey));
  return {
    totalDetails: seeded.details.length,
    activeParticipants: 6,
    coveredActivitiesPct: Math.round((covered.size / seeded.activityKeys.size) * 1000) / 10,
    byType: count((detail) => detail.type),
    byPriority: count((detail) => detail.priority ?? 'none'),
    byRole: count((detail) => detail.authorRole),
    byStatus: count((detail) => detail.status),
  };
}

/** Cabeceras extra de cada petición (los E2E envían su `x-real-ip`). */
let extraHeaders: Record<string, string> = {};

async function call<T>(
  apiUrl: string,
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...extraHeaders,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body instanceof FormData || body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
    },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${await response.text()}`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

async function register(apiUrl: string, name: string): Promise<Person> {
  const suffix = randomUUID().slice(0, 8);
  const email = `tienda-${suffix}@example.com`;
  const password = `clave-tienda-${suffix}`;
  const session = await call<{ accessToken: string; user: { id: string } }>(
    apiUrl,
    'POST',
    '/auth/register',
    null,
    { name: `${name} ${suffix}`, email, password },
  );
  return { name, email, password, accessToken: session.accessToken, id: session.user.id };
}

export async function seedAnalyticsProject(
  apiUrl: string,
  headers: Record<string, string> = {},
): Promise<SeededProject> {
  extraHeaders = headers;
  const validation = JSON.parse(readFileSync(VALIDATION, 'utf8')) as Validation;
  const boxes = (
    JSON.parse(readFileSync(BOXES, 'utf8')) as {
      activities: Array<{ bbox: { x: number; y: number; w: number; h: number } }>;
    }
  ).activities;

  const admin = await register(apiUrl, 'Ana');
  const participants: Person[] = [];
  for (const name of ['Luis', 'Marta', 'Jorge', 'Elena', 'Pablo']) {
    participants.push(await register(apiUrl, name));
  }
  const project = await call<{ id: string }>(apiUrl, 'POST', '/projects', admin.accessToken, {
    name: 'Tienda demo',
  });
  await call(apiUrl, 'POST', `/projects/${project.id}/status`, admin.accessToken, {
    action: 'open',
  });
  for (const participant of participants) {
    const invitation = await call<{ url: string }>(
      apiUrl,
      'POST',
      `/projects/${project.id}/invitations`,
      admin.accessToken,
    );
    const token = invitation.url.split('/').pop()!;
    await call(apiUrl, 'POST', `/invitations/${token}/accept`, participant.accessToken);
  }

  const form = new FormData();
  form.set('name', 'Proceso de compra');
  form.set('file', new Blob([readFileSync(IMAGE)], { type: 'image/png' }), 'cien-actividades.png');
  const version = await call<{ id: string; diagramId: string }>(
    apiUrl,
    'POST',
    `/projects/${project.id}/diagrams`,
    admin.accessToken,
    form,
  );
  const activityKeys = new Map<string, string>();
  for (const [index, activity] of validation.input.activities.entries()) {
    const created = await call<{ key: string }>(
      apiUrl,
      'POST',
      `/diagram-versions/${version.id}/activities`,
      admin.accessToken,
      { label: activity.label, type: 'action', bbox: boxes[index]!.bbox },
    );
    activityKeys.set(activity.key, created.key);
  }
  await call(apiUrl, 'POST', `/diagram-versions/${version.id}/publish`, admin.accessToken);

  const people = [admin, ...participants];
  const details: SeededDetail[] = [];
  for (const [index, detail] of pickDetails(validation).entries()) {
    const authorIndex = index % people.length;
    const author = people[authorIndex]!;
    const created = await call<{ id: string }>(
      apiUrl,
      'POST',
      `/diagrams/${version.diagramId}/activities/${activityKeys.get(detail.activityKey)}/details`,
      author.accessToken,
      {
        given: detail.given,
        when: detail.when,
        then: detail.then,
        type: detail.type,
        priority: detail.priority,
        authorRole: detail.authorRole,
        tags: detail.tags,
      },
    );
    // Votos y comentarios de las demás personas (nadie vota lo suyo); como máximo 5.
    const others = people.filter((_, i) => i !== authorIndex);
    for (const voter of others.slice(0, Math.min(detail.voteCount, others.length))) {
      await call(apiUrl, 'PUT', `/details/${created.id}/vote`, voter.accessToken);
    }
    for (const commenter of others.slice(0, Math.min(detail.commentCount, others.length))) {
      await call(apiUrl, 'POST', `/details/${created.id}/comments`, commenter.accessToken, {
        text: 'Comentario de la sesión de levantamiento.',
      });
    }
    if (detail.status === 'validated') {
      await call(apiUrl, 'POST', `/details/${created.id}/status`, admin.accessToken, {
        status: 'validated',
      });
    }
    details.push({ ...detail, apiId: created.id, authorIndex });
  }

  return {
    projectId: project.id,
    diagramId: version.diagramId,
    versionId: version.id,
    admin,
    participants,
    activityKeys,
    details,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apiIndex = args.indexOf('--api');
  const apiUrl =
    apiIndex >= 0 ? args[apiIndex + 1]! : process.env.API_URL || 'http://localhost:3000';
  const seeded = await seedAnalyticsProject(apiUrl);
  console.log(
    `Tienda demo: proyecto ${seeded.projectId} · Administradora ${seeded.admin.email} ` +
      `(contraseña ${seeded.admin.password})`,
  );
  if (args.includes('--print-expected')) {
    console.log(JSON.stringify(expectedIndicators(seeded), null, 2));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
