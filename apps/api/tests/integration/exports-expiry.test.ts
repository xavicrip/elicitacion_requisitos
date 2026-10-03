import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportsModel, type ExportDoc } from '../../src/modules/exports/models/export';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US1 de la 008 (FR-007): los archivos se pueden descargar durante 24 h; después la descarga
// responde 410 y la limpieza horaria los borra del bucket.

let app: FastifyInstance;
let ana: TestUser;
let projectId: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('exportsexpiry', {
    withAuth: true,
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  projectId = await seedProject(app, { status: 'open', members: [[ana, 'admin']] });
});
afterAll(() => closeTestApp(app));

async function stored(name: string, expiresAt: Date) {
  const _id = new Types.ObjectId();
  const fileKey = `projects/${projectId}/exports/${_id.toHexString()}.csv`;
  await app.storage.put(fileKey, Buffer.from(`"${name}"\r\n`), 'text/csv; charset=utf-8');
  await exportsModel(app.mongo).create({
    _id,
    projectId: new Types.ObjectId(projectId),
    format: 'csv',
    options: { delimiter: 'comma', includePending: false },
    filters: { diagramIds: null, from: null, to: null, types: null, statuses: ['pending'] },
    mode: 'async',
    status: 'done',
    detailCount: 1500,
    fileKey,
    fileName: `${name}.csv`,
    bytes: 10,
    requestedBy: new Types.ObjectId(ana.id),
    finishedAt: new Date(expiresAt.getTime() - 24 * 60 * 60 * 1000),
    expiresAt,
  });
  return { id: _id.toHexString(), fileKey };
}

const get = (url: string) => app.inject({ url, headers: authHeaders(ana) });
const exists = async (key: string) => (await app.storage.listKeys(key)).includes(key);

describe('caducidad', () => {
  it('pasadas 24 h la exportación sale como caducada y la descarga responde 410', async () => {
    const fresh = await stored('vigente', new Date(Date.now() + 60_000));
    const stale = await stored('caducada', new Date(Date.now() - 1000));

    expect((await get(`/exports/${fresh.id}`)).json()).toMatchObject({ expired: false });
    expect((await get(`/exports/${fresh.id}/download`)).statusCode).toBe(200);

    expect((await get(`/exports/${stale.id}`)).json()).toMatchObject({
      status: 'done',
      expired: true,
    });
    const gone = await get(`/exports/${stale.id}/download`);
    expect(gone.statusCode).toBe(410);
    expect(gone.json()).toEqual({
      code: 'EXPORT_EXPIRED',
      message: 'El enlace caducó. Vuelve a exportar.',
    });
  });

  it('la limpieza borra del bucket solo los archivos caducados y vacía su fileKey', async () => {
    const fresh = await stored('sigue', new Date(Date.now() + 60_000));
    const stale = await stored('se-borra', new Date(Date.now() - 1000));
    expect(await exists(stale.fileKey)).toBe(true);

    expect(await app.exportFiles.sweep()).toBeGreaterThanOrEqual(1);

    expect(await exists(stale.fileKey)).toBe(false);
    expect(await exists(fresh.fileKey)).toBe(true);
    const find = (id: string) => exportsModel(app.mongo).findById(id).lean<ExportDoc>();
    expect((await find(stale.id))!.fileKey).toBeNull();
    expect((await find(fresh.id))!.fileKey).toBe(fresh.fileKey);
    // Repetirla no hace nada más; el historial conserva la exportación como caducada.
    expect(await app.exportFiles.sweep()).toBe(0);
    expect((await get(`/exports/${stale.id}`)).json()).toMatchObject({
      status: 'done',
      expired: true,
    });
    expect((await get(`/exports/${stale.id}/download`)).statusCode).toBe(410);
  });

  it('una exportación inmediata no se conserva: su descarga responde 410', async () => {
    const sync = await exportsModel(app.mongo).create({
      projectId: new Types.ObjectId(projectId),
      format: 'csv',
      options: { delimiter: 'comma', includePending: false },
      filters: { diagramIds: null, from: null, to: null, types: null, statuses: ['pending'] },
      mode: 'sync',
      status: 'done',
      detailCount: 3,
      fileName: 'x.csv',
      requestedBy: new Types.ObjectId(ana.id),
      finishedAt: new Date(),
    });
    expect((await get(`/exports/${sync._id.toHexString()}/download`)).statusCode).toBe(410);
  });
});
