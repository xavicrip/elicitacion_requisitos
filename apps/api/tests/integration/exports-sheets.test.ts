import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogsModel } from '../../src/modules/audit/model';
import { detailsModel } from '../../src/modules/details/models/detail';
import { exportsModel, type ExportDoc } from '../../src/modules/exports/models/export';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US1 de la 008 (FR-002, FR-003, FR-008): CSV y Excel en streaming por debajo del umbral.

let app: FastifyInstance;
let ana: TestUser;
let projectId: string;
let emptyProjectId: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('exportssheets', {
    withAuth: true,
    exports: { syncLimit: 5 },
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  projectId = await seedProject(app, {
    name: 'Tienda Demo: ¡Ñandú!',
    status: 'open',
    members: [[ana, 'admin']],
  });
  emptyProjectId = await seedProject(app, { status: 'open', members: [[ana, 'admin']] });
  const { diagramId, keys } = await publishedDiagram(app, authHeaders(ana), projectId);
  const detail = (fields: Record<string, unknown>) =>
    detailsModel(app.mongo).create({
      projectId: new Types.ObjectId(projectId),
      diagramId: new Types.ObjectId(diagramId),
      activityKey: keys['Validar pago']!,
      given: 'el cliente tiene productos',
      when: 'paga con tarjeta',
      then: 'el sistema confirma el pago',
      type: 'functional',
      authorId: new Types.ObjectId(ana.id),
      ...fields,
    });
  await detail({ given: '=HYPERLINK("http://x","clic")' });
  await detail({ status: 'validated', then: 'el señor Núñez recibe,\nsu factura' });
  await detail({ status: 'validated', activityKey: keys['Emitir factura']! });
  await detail({ status: 'discarded', discardReason: 'Fuera de alcance' });
});
afterAll(() => closeTestApp(app));

const request = (project: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/projects/${project}/exports`,
    headers: authHeaders(ana),
    payload,
  });

const records = (body: Buffer, delimiter = ',') =>
  parse(body, { bom: true, delimiter, record_delimiter: '\r\n' }) as string[][];

describe('CSV', () => {
  it('200 con el archivo, su nombre y el identificador de la exportación', async () => {
    const response = await request(projectId, { format: 'csv' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="reqcanvas-tienda-demo-nandu-\d{8}-\d{4}\.csv"$/,
    );
    expect(response.headers['x-export-empty']).toBeUndefined();
    const rows = records(response.rawPayload);
    // Por defecto, pendientes y validados: 3 de los 4.
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveLength(18);
    expect(rows.slice(1).map((row) => row[3])).toContain('\'=HYPERLINK("http://x","clic")');
    expect(rows.slice(1).map((row) => row[5])).toContain('el señor Núñez recibe,\nsu factura');
    expect(rows.slice(1).every((row) => row[15] === ana.name)).toBe(true);

    const exported = await exportsModel(app.mongo)
      .findById(response.headers['x-export-id'] as string)
      .lean<ExportDoc>();
    expect(exported).toMatchObject({
      format: 'csv',
      mode: 'sync',
      status: 'done',
      detailCount: 3,
      fileKey: null,
      expiresAt: null,
      options: { delimiter: 'comma', includePending: false },
    });
    expect(exported!.fileName).toMatch(/^reqcanvas-tienda-demo-nandu-.*\.csv$/);
  });

  it('respeta los filtros y el delimitador', async () => {
    const validated = await request(projectId, {
      format: 'csv',
      filters: { statuses: ['validated'] },
      options: { delimiter: 'semicolon' },
    });
    const rows = records(validated.rawPayload, ';');
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).every((row) => row[10] === 'Validado')).toBe(true);

    const discarded = await request(projectId, {
      format: 'csv',
      filters: { statuses: ['discarded'] },
    });
    expect(
      records(discarded.rawPayload)
        .slice(1)
        .map((row) => row[12]),
    ).toEqual(['Fuera de alcance']);
  });

  it('sin detalles: solo los encabezados y la cabecera X-Export-Empty', async () => {
    const response = await request(emptyProjectId, { format: 'csv' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-export-empty']).toBe('true');
    expect(records(response.rawPayload)).toHaveLength(1);
  });
});

describe('Excel', () => {
  it('200 con un libro que se puede leer, con sus dos hojas', async () => {
    const response = await request(projectId, { format: 'xlsx' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers['content-disposition']).toMatch(/\.xlsx"$/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(response.rawPayload as never);
    const sheet = book.getWorksheet('Requisitos')!;
    expect(sheet.rowCount).toBe(4);
    const givens = [2, 3, 4].map((row) => sheet.getRow(row).getCell(4).value);
    expect(givens).toContain('\'=HYPERLINK("http://x","clic")');
    expect(book.getWorksheet('Resumen')).toBeDefined();
  });
});

describe('auditoría y límites', () => {
  it('cada exportación queda en auditoría con formato, filtros y número de detalles (FR-008)', async () => {
    const response = await request(projectId, {
      format: 'xlsx',
      filters: { statuses: ['validated'] },
    });
    const log = await auditLogsModel(app.mongo)
      .findOne({ action: 'export.requested', 'entity.id': String(response.headers['x-export-id']) })
      .lean();
    expect(log).toMatchObject({
      diff: { format: 'xlsx', count: 2, filters: { statuses: ['validated'] } },
    });
    expect(log!.actorId!.toHexString()).toBe(ana.id);
  });

  it('las exportaciones aparecen en el historial como síncronas y terminadas', async () => {
    const response = await app.inject({
      url: `/projects/${projectId}/exports`,
      headers: authHeaders(ana),
    });
    const listed = response.json<Array<{ mode: string; status: string; expired: boolean }>>();
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((item) => item.mode === 'sync' && item.status === 'done')).toBe(true);
    expect(listed.every((item) => !item.expired)).toBe(true);
  });
});
