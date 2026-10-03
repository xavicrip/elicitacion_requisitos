import type { DashboardFilters } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogsModel } from '../../src/modules/audit/model';
import { exportsModel } from '../../src/modules/exports/models/export';
import { exportsService } from '../../src/modules/exports/service';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Feature 008: historial y estado de las exportaciones; solo Administradores (FR-001) y
// auditoría de cada solicitud (FR-008).

let app: FastifyInstance;
let ana: TestUser;
let luis: TestUser;
let outsider: TestUser;
let projectId: string;

const FILTERS: DashboardFilters = {
  diagramIds: null,
  from: null,
  to: null,
  types: null,
  statuses: ['validated'],
};
const OPTIONS = { delimiter: 'comma', includePending: false } as const;

beforeAll(async () => {
  ({ app } = await buildTestApp('exports', { withAuth: true, featureFlags: 'exports=true' }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
  outsider = await registerTestUser(app, 'Otra');
  projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
    ],
  });
});
afterAll(() => closeTestApp(app));

const seed = (fields: Record<string, unknown> = {}) =>
  exportsModel(app.mongo).create({
    projectId: new Types.ObjectId(projectId),
    format: 'csv',
    options: OPTIONS,
    filters: FILTERS,
    mode: 'sync',
    status: 'done',
    detailCount: 3,
    fileName: 'reqcanvas-proyecto-20261003-1000.csv',
    requestedBy: new Types.ObjectId(ana.id),
    finishedAt: new Date(),
    ...fields,
  });

describe('historial y estado', () => {
  it('lista las exportaciones del proyecto, de la más reciente a la más antigua', async () => {
    const old = await seed({ createdAt: new Date('2026-10-01T10:00:00Z') });
    const recent = await seed({ format: 'xlsx', createdAt: new Date('2026-10-02T10:00:00Z') });
    await exportsModel(app.mongo).create({
      ...(await seed()).toObject(),
      _id: new Types.ObjectId(),
      projectId: new Types.ObjectId(),
    });
    const response = await app.inject({
      url: `/projects/${projectId}/exports`,
      headers: authHeaders(ana),
    });
    expect(response.statusCode).toBe(200);
    const listed = response.json<Array<{ id: string; projectId: string }>>();
    expect(listed.every((item) => item.projectId === projectId)).toBe(true);
    const order = listed.map((item) => item.id);
    expect(order.indexOf(recent._id.toHexString())).toBeLessThan(
      order.indexOf(old._id.toHexString()),
    );
  });

  it('expired se calcula al leer: una exportación con más de 24 h ya no se puede descargar', async () => {
    const fresh = await seed({
      mode: 'async',
      fileKey: 'k1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const stale = await seed({
      mode: 'async',
      fileKey: 'k2',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const get = async (id: Types.ObjectId) =>
      (await app.inject({ url: `/exports/${id.toHexString()}`, headers: authHeaders(ana) })).json();
    expect(await get(fresh._id)).toMatchObject({ status: 'done', expired: false });
    expect(await get(stale._id)).toMatchObject({ status: 'done', expired: true });
    // Las síncronas no tienen archivo ni caducidad.
    expect(await get((await seed())._id)).toMatchObject({ expired: false, expiresAt: null });
  });
});

describe('permisos (FR-001)', () => {
  it('un Participante recibe 403 y una cuenta ajena 404 en todas las rutas', async () => {
    const exported = await seed();
    const requests: Array<['GET' | 'POST', string]> = [
      ['GET', `/projects/${projectId}/exports`],
      ['POST', `/projects/${projectId}/exports`],
      ['GET', `/exports/${exported._id.toHexString()}`],
    ];
    for (const [method, url] of requests) {
      const payload = method === 'POST' ? { payload: { format: 'csv' } } : {};
      const asParticipant = await app.inject({
        method,
        url,
        headers: authHeaders(luis),
        ...payload,
      });
      expect(asParticipant.statusCode, `${method} ${url}`).toBe(403);
      const asOutsider = await app.inject({
        method,
        url,
        headers: authHeaders(outsider),
        ...payload,
      });
      expect(asOutsider.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});

describe('registro de una exportación', () => {
  const input = (format: 'csv' | 'pdf', status: 'done' | 'pending') => ({
    format,
    filters: FILTERS,
    options: OPTIONS,
    mode: status === 'done' ? ('sync' as const) : ('async' as const),
    status,
    detailCount: 7,
    fileName: `reqcanvas-proyecto.${format}`,
    requestedBy: ana.id,
  });

  it('queda en auditoría con el formato, los filtros y el número de detalles (FR-008)', async () => {
    const project = new Types.ObjectId(projectId);
    const created = await exportsService(app).create(project, input('csv', 'done'));
    expect(created).toMatchObject({ status: 'done', mode: 'sync', fileKey: null, detailCount: 7 });
    expect(created.finishedAt).toBeInstanceOf(Date);
    const log = await auditLogsModel(app.mongo)
      .findOne({ action: 'export.requested', 'entity.id': created._id.toHexString() })
      .lean();
    expect(log).toMatchObject({
      entity: { type: 'export' },
      diff: { format: 'csv', count: 7, filters: FILTERS, options: OPTIONS },
    });
    expect(log!.actorId!.toHexString()).toBe(ana.id);
    expect(log!.projectId!.toHexString()).toBe(projectId);
  });

  it('una segunda exportación del mismo formato en curso responde 409', async () => {
    const project = new Types.ObjectId(projectId);
    await exportsService(app).create(project, input('pdf', 'pending'));
    await expect(
      exportsService(app).create(project, input('pdf', 'pending')),
    ).rejects.toMatchObject({ statusCode: 409, code: 'EXPORT_IN_PROGRESS' });
    // Otro formato, o el mismo ya terminado, no chocan.
    await exportsService(app).create(project, input('csv', 'done'));
  });
});
