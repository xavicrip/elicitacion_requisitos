import { DashboardFiltersSchema, type DashboardFiltersInput } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detailsModel } from '../../src/modules/details/models/detail';
import { exportQuery, type ExportRow } from '../../src/modules/exports/query';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Feature 008 (FR-002): la selección de detalles de una exportación usa los filtros de la 007
// y resuelve los nombres. Los días son los de la zona del proyecto (America/Guayaquil, UTC-5).

let app: FastifyInstance;
let ana: TestUser;
let luis: TestUser;
let projectId: Types.ObjectId;
let diagramId: string;
let otherDiagramId: string;
let keys: Record<string, string>;
const ids: Record<string, Types.ObjectId> = {};

beforeAll(async () => {
  ({ app } = await buildTestApp('exportsquery', { withAuth: true }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
  const project = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
    ],
  });
  projectId = new Types.ObjectId(project);
  ({ diagramId, keys } = await publishedDiagram(app, authHeaders(ana), project));
  const other = await publishedDiagram(app, authHeaders(ana), project, ['Auditar accesos']);
  otherDiagramId = other.diagramId;

  const create = async (name: string, fields: Record<string, unknown>) => {
    const detail = await detailsModel(app.mongo).create({
      projectId,
      diagramId: new Types.ObjectId(diagramId),
      activityKey: keys['Validar pago']!,
      given: `dado ${name}`,
      when: 'paga con tarjeta',
      then: 'el sistema confirma el pago',
      type: 'functional',
      authorId: new Types.ObjectId(ana.id),
      createdAt: new Date('2026-09-10T15:00:00Z'),
      ...fields,
    });
    ids[name] = detail._id;
  };
  await create('a', { priority: 'must', authorRole: 'Cajero', tags: ['pagos', 'tarjeta'] });
  await create('b', {
    activityKey: keys['Emitir factura']!,
    type: 'non_functional',
    status: 'validated',
    authorId: new Types.ObjectId(luis.id),
    voteCount: 2,
    commentCount: 1,
    // 23:30 del 11 de septiembre en Guayaquil.
    createdAt: new Date('2026-09-12T04:30:00Z'),
  });
  await create('c', { status: 'duplicate', duplicateOf: ids.a });
  await create('d', { status: 'discarded', discardReason: 'Fuera de alcance' });
  await create('e', { activityKey: 'ya-no-existe', createdAt: new Date('2026-09-09T15:00:00Z') });
  await create('f', {
    diagramId: new Types.ObjectId(otherDiagramId),
    activityKey: other.keys['Auditar accesos']!,
  });
  // Otro proyecto: nunca aparece.
  await detailsModel(app.mongo).create({
    projectId: new Types.ObjectId(),
    diagramId: new Types.ObjectId(),
    activityKey: 'x',
    given: 'dado ajeno',
    when: 'x',
    then: 'x',
    type: 'functional',
    authorId: new Types.ObjectId(ana.id),
  });
});

afterAll(() => closeTestApp(app));

async function rows(filters: DashboardFiltersInput = {}): Promise<ExportRow[]> {
  const result: ExportRow[] = [];
  for await (const row of exportQuery(app).rows(projectId, DashboardFiltersSchema.parse(filters))) {
    result.push(row);
  }
  return result;
}
const givens = (list: ExportRow[]) => list.map((row) => row.given.slice(-1)).sort();
const count = (filters: DashboardFiltersInput = {}) =>
  exportQuery(app).count(projectId, DashboardFiltersSchema.parse(filters));

describe('filtros', () => {
  it('por defecto, pendientes y validados del proyecto', async () => {
    expect(givens(await rows())).toEqual(['a', 'b', 'e', 'f']);
    expect(await count()).toBe(4);
  });

  it('por estado, incluidos los duplicados y los descartados si se piden', async () => {
    expect(givens(await rows({ statuses: ['validated'] }))).toEqual(['b']);
    expect(
      givens(await rows({ statuses: ['pending', 'validated', 'duplicate', 'discarded'] })),
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(await count({ statuses: ['duplicate', 'discarded'] })).toBe(2);
  });

  it('por tipo y por diagrama', async () => {
    expect(givens(await rows({ types: ['non_functional'] }))).toEqual(['b']);
    expect(givens(await rows({ diagramIds: [otherDiagramId] }))).toEqual(['f']);
  });

  it('por fechas, en los días de la zona horaria del proyecto', async () => {
    expect(givens(await rows({ from: '2026-09-11', to: '2026-09-11' }))).toEqual(['b']);
    expect(givens(await rows({ to: '2026-09-09' }))).toEqual(['e']);
    expect(await count({ from: '2026-09-12' })).toBe(0);
  });
});

describe('filas', () => {
  it('resuelven diagrama, actividad, autor e IDs cortos', async () => {
    const all = await rows({ statuses: ['pending', 'validated', 'duplicate', 'discarded'] });
    const byName = Object.fromEntries(all.map((row) => [row.given.slice(-1), row]));
    expect(byName.a).toMatchObject({
      id: ids.a!.toHexString(),
      shortId: ids.a!.toHexString().slice(-8),
      diagramId,
      activityLabel: 'Validar pago',
      authorName: ana.name,
      priority: 'must',
      authorRole: 'Cajero',
      tags: ['pagos', 'tarjeta'],
      status: 'pending',
      duplicateOfShortId: null,
      discardReason: null,
    });
    expect(byName.a!.diagramName).not.toBe('');
    expect(byName.b).toMatchObject({
      activityLabel: 'Emitir factura',
      authorName: luis.name,
      voteCount: 2,
      commentCount: 1,
      status: 'validated',
    });
    expect(byName.b!.createdAt).toEqual(new Date('2026-09-12T04:30:00Z'));
    expect(byName.c!.duplicateOfShortId).toBe(ids.a!.toHexString().slice(-8));
    expect(byName.d!.discardReason).toBe('Fuera de alcance');
    // La actividad ya no está en la versión publicada.
    expect(byName.e!.activityLabel).toBeNull();
  });

  it('van agrupadas por diagrama y actividad, y por fecha dentro de cada una', async () => {
    const all = await rows({ statuses: ['pending', 'validated', 'duplicate', 'discarded'] });
    const groups = all.map((row) => `${row.diagramId}/${row.activityKey}`);
    const seen: string[] = [];
    for (const group of groups) if (seen.at(-1) !== group) seen.push(group);
    expect(new Set(seen).size).toBe(seen.length);
    for (const group of seen) {
      const times = all
        .filter((row) => `${row.diagramId}/${row.activityKey}` === group)
        .map((row) => row.createdAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });
});
