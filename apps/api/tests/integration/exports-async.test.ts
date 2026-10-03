import { Writable } from 'node:stream';
import { ExportSchema, type ExportFormat } from '@reqcanvas/shared';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { auditLogsModel } from '../../src/modules/audit/model';
import { detailsModel } from '../../src/modules/details/models/detail';
import { exportsModel, type ExportDoc } from '../../src/modules/exports/models/export';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US1 de la 008 (FR-006, FR-007, FR-008): por encima del umbral (aquí, 2 detalles) la
// exportación se genera en segundo plano, queda en el bucket 24 h y se descarga a través de api.

let app: FastifyInstance;
let ana: TestUser;
let projectId: string;
const logs: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        logs.push(JSON.parse(line) as Record<string, unknown>);
      }
      done();
    },
  });
  ({ app } = await buildTestApp('exportsasync', {
    withAuth: true,
    featureFlags: 'exports=true',
    exports: { syncLimit: 2 },
    logStream,
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  projectId = await seedProject(app, { status: 'open', members: [[ana, 'admin']] });
  const { diagramId, keys } = await publishedDiagram(app, authHeaders(ana), projectId);
  for (let index = 0; index < 3; index++) {
    await detailsModel(app.mongo).create({
      projectId: new Types.ObjectId(projectId),
      diagramId: new Types.ObjectId(diagramId),
      activityKey: keys['Validar pago']!,
      given: `el cliente tiene el pedido ${index}`,
      when: 'paga con tarjeta',
      then: 'el sistema confirma el pago',
      type: 'functional',
      authorId: new Types.ObjectId(ana.id),
    });
  }
});
afterAll(() => closeTestApp(app));

const headers = () => authHeaders(ana);
const request = (payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/projects/${projectId}/exports`,
    headers: headers(),
    payload,
  });
const statusOf = async (id: string) =>
  (await app.inject({ url: `/exports/${id}`, headers: headers() })).json<{
    status: string;
    [key: string]: unknown;
  }>();
const download = (id: string) => app.inject({ url: `/exports/${id}/download`, headers: headers() });

async function finished(id: string) {
  await vi.waitFor(async () => expect((await statusOf(id)).status).toMatch(/^(done|failed)$/), {
    timeout: 10_000,
    interval: 50,
  });
  return statusOf(id);
}

const StrictExport = z.strictObject({
  ...ExportSchema.shape,
  error: z.strictObject({ code: z.string(), message: z.string() }).nullable(),
});
const StrictError = z.strictObject({ code: z.string(), message: z.string() });

describe('exportación en segundo plano', () => {
  it('202 con la exportación pendiente; al terminar se descarga el CSV', async () => {
    const response = await request({ format: 'csv' });
    expect(response.statusCode).toBe(202);
    expect(StrictExport.safeParse(response.json()).error?.issues ?? []).toEqual([]);
    expect(response.json()).toMatchObject({
      format: 'csv',
      mode: 'async',
      status: 'pending',
      expired: false,
      detailCount: 3,
      bytes: null,
      expiresAt: null,
    });
    const { id } = response.json<{ id: string }>();

    const done = await finished(id);
    expect(done).toMatchObject({ status: 'done', expired: false, error: null });
    expect(done.bytes).toBeGreaterThan(0);
    expect(done.fileName).toMatch(/^reqcanvas-.*\.csv$/);
    const ttl = Date.parse(done.expiresAt as string) - Date.parse(done.finishedAt as string);
    expect(ttl).toBe(24 * 60 * 60 * 1000);

    const file = await download(id);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(file.headers['content-disposition']).toBe(`attachment; filename="${done.fileName}"`);
    expect(Number(file.headers['content-length'])).toBe(done.bytes);
    const rows = parse(file.rawPayload, { bom: true, record_delimiter: '\r\n' }) as string[][];
    expect(rows).toHaveLength(4);

    const stored = await exportsModel(app.mongo).findById(id).lean<ExportDoc>();
    expect(stored!.fileKey).toBe(`projects/${projectId}/exports/${id}.csv`);
    const actions = (
      await auditLogsModel(app.mongo).find({ 'entity.id': id }).sort({ at: 1 }).lean()
    ).map((log) => log.action);
    expect(actions).toEqual(['export.requested', 'export.downloaded']);
  });

  it('también Excel; el log de fin lleva la duración y el tamaño (constitución VI)', async () => {
    const { id } = (await request({ format: 'xlsx' })).json<{ id: string }>();
    const done = await finished(id);
    expect(done.status).toBe('done');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await download(id)).rawPayload as never);
    expect(book.getWorksheet('Requisitos')!.rowCount).toBe(4);
    const log = logs.find((entry) => entry.msg === 'Exportación generada' && entry.exportId === id);
    expect(log).toMatchObject({ format: 'xlsx', projectId, bytes: done.bytes });
    expect(log!.durationMs).toEqual(expect.any(Number));
  });

  it('por debajo del umbral sigue siendo inmediata', async () => {
    const response = await request({ format: 'csv', filters: { statuses: ['validated'] } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-export-empty']).toBe('true');
  });
});

describe('estados intermedios y errores', () => {
  const pending = (format: ExportFormat, fields: Record<string, unknown> = {}) =>
    exportsModel(app.mongo).create({
      projectId: new Types.ObjectId(projectId),
      format,
      options: { delimiter: 'comma', includePending: false },
      filters: { diagramIds: null, from: null, to: null, types: null, statuses: ['pending'] },
      mode: 'async',
      status: 'pending',
      detailCount: 3,
      fileName: `reqcanvas-proyecto.${format}`,
      requestedBy: new Types.ObjectId(ana.id),
      ...fields,
    });

  it('descargar antes de que termine responde 409; con una en curso, otra del mismo formato también', async () => {
    const waiting = await pending('xlsx');
    const early = await download(waiting._id.toHexString());
    expect(early.statusCode).toBe(409);
    expect(StrictError.safeParse(early.json()).success).toBe(true);
    expect(early.json().code).toBe('EXPORT_NOT_READY');

    const second = await request({ format: 'xlsx' });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({
      code: 'EXPORT_IN_PROGRESS',
      message: 'Ya hay una exportación de este formato en preparación.',
    });
    // Otro formato no choca.
    const other = await request({ format: 'csv' });
    expect(other.statusCode).toBe(202);
    await finished(other.json<{ id: string }>().id);
    await exportsModel(app.mongo).deleteOne({ _id: waiting._id });
  });

  it('un fallo al generar deja la exportación failed con EXPORT_FAILED', async () => {
    // El worker de `api` no sabe generar este formato: sirve para provocar el fallo.
    const broken = await pending('pdf');
    await app.exportFiles.enqueue(broken.toObject<ExportDoc>());
    const failed = await finished(broken._id.toHexString());
    expect(failed).toMatchObject({
      status: 'failed',
      error: { code: 'EXPORT_FAILED', message: 'No se pudo generar la exportación.' },
      bytes: null,
    });
    const file = await download(broken._id.toHexString());
    expect(file.statusCode).toBe(410);
  });
});
