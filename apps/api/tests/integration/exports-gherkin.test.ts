import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { detailsModel } from '../../src/modules/details/models/detail';
import { exportsModel, type ExportDoc } from '../../src/modules/exports/models/export';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { publishedDiagram } from '../helpers/details';
import { parseFeature, unzip } from '../helpers/gherkin';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US2 de la 008 (FR-004, SC-002): ZIP con un `.feature` por actividad; por defecto solo los
// validados. Por encima del umbral (aquí, 3 detalles) lo genera la cola `export-files`.

let app: FastifyInstance;
let ana: TestUser;
let projectId: string;
let emptyProjectId: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('exportsgherkin', {
    withAuth: true,
    exports: { syncLimit: 3 },
  }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  projectId = await seedProject(app, {
    name: 'Tienda Demo',
    status: 'open',
    members: [[ana, 'admin']],
  });
  emptyProjectId = await seedProject(app, { status: 'open', members: [[ana, 'admin']] });
  const { diagramId, keys } = await publishedDiagram(app, authHeaders(ana), projectId, [
    'Validar pago',
    '¿Validar pago?',
    'Emitir factura',
    'Enviar pedido',
  ]);
  const detail = (label: string, fields: Record<string, unknown>) =>
    detailsModel(app.mongo).create({
      projectId: new Types.ObjectId(projectId),
      diagramId: new Types.ObjectId(diagramId),
      activityKey: keys[label]!,
      given: 'el cliente tiene productos',
      when: 'paga con tarjeta',
      then: 'el sistema confirma el pago',
      type: 'functional',
      authorId: new Types.ObjectId(ana.id),
      ...fields,
    });
  await detail('Validar pago', { status: 'validated', priority: 'must', tags: ['Pagos'] });
  await detail('Validar pago', { then: 'se avisa\nal cliente' });
  await detail('¿Validar pago?', { status: 'validated' });
  await detail('Emitir factura', {});
  await detail('Enviar pedido', { status: 'discarded', discardReason: 'Fuera de alcance' });
  // Solo pendientes en el proyecto «vacío»: nada que exportar por defecto.
  const other = await publishedDiagram(app, authHeaders(ana), emptyProjectId);
  await detailsModel(app.mongo).create({
    projectId: new Types.ObjectId(emptyProjectId),
    diagramId: new Types.ObjectId(other.diagramId),
    activityKey: other.keys['Validar pago']!,
    given: 'a',
    when: 'b',
    then: 'c',
    type: 'functional',
    authorId: new Types.ObjectId(ana.id),
  });
});
afterAll(() => closeTestApp(app));

const request = (project: string, payload: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: `/projects/${project}/exports`,
    headers: authHeaders(ana),
    payload: { format: 'gherkin', ...payload },
  });

/** Rutas del ZIP sin la carpeta del diagrama, y el número de escenarios de cada archivo. */
function summary(zip: Map<string, string>) {
  return Object.fromEntries(
    [...zip].map(([path, content]) => [
      path.split('/')[1],
      parseFeature(content).feature!.children.length,
    ]),
  );
}

describe('Gherkin', () => {
  it('200 con el ZIP: un .feature por actividad con detalles validados', async () => {
    const response = await request(projectId);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="reqcanvas-tienda-demo-gherkin.zip"',
    );
    expect(response.headers['x-export-empty']).toBeUndefined();
    const zip = await unzip(response.rawPayload);
    expect([...zip.keys()].every((path) => /^[a-z0-9-]+\/[a-z0-9-]+\.feature$/.test(path))).toBe(
      true,
    );
    expect(new Set([...zip.keys()].map((path) => path.split('/')[0])).size).toBe(1);
    expect(summary(zip)).toEqual({ 'validar-pago.feature': 1, 'validar-pago-2.feature': 1 });
    const feature = [...zip.values()].find((content) => content.includes('@must'))!;
    expect(feature).toContain('  @must @funcional @pagos @validado\n');

    const exported = await exportsModel(app.mongo)
      .findById(response.headers['x-export-id'] as string)
      .lean<ExportDoc>();
    expect(exported).toMatchObject({
      format: 'gherkin',
      mode: 'sync',
      status: 'done',
      detailCount: 2,
      fileName: 'reqcanvas-tienda-demo-gherkin.zip',
      filters: { statuses: ['validated'] },
    });
  });

  it('solo los validados, sea cual sea el filtro de estados', async () => {
    const response = await request(projectId, {
      filters: { statuses: ['pending', 'discarded'] },
    });
    expect(response.statusCode).toBe(200);
    expect(summary(await unzip(response.rawPayload))).toEqual({
      'validar-pago.feature': 1,
      'validar-pago-2.feature': 1,
    });
  });

  it('con includePending añade los pendientes; por encima del umbral, en segundo plano', async () => {
    const response = await request(projectId, {
      filters: { statuses: ['discarded'] },
      options: { includePending: true },
    });
    expect(response.statusCode).toBe(202);
    const { id } = response.json<{ id: string }>();
    expect(response.json()).toMatchObject({ format: 'gherkin', mode: 'async', detailCount: 4 });
    const statusOf = async () =>
      (await app.inject({ url: `/exports/${id}`, headers: authHeaders(ana) })).json<{
        status: string;
      }>().status;
    await vi.waitFor(async () => expect(await statusOf()).toBe('done'), {
      timeout: 10_000,
      interval: 50,
    });

    const file = await app.inject({ url: `/exports/${id}/download`, headers: authHeaders(ana) });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/zip');
    const zip = await unzip(file.rawPayload);
    // «Enviar pedido» solo tiene un descartado: no lleva archivo.
    // (el orden de las dos «Validar pago» depende de sus claves).
    const counts = summary(zip);
    expect(Object.keys(counts).sort()).toEqual([
      'emitir-factura.feature',
      'validar-pago-2.feature',
      'validar-pago.feature',
    ]);
    expect(counts['emitir-factura.feature']).toBe(1);
    expect(counts['validar-pago.feature']! + counts['validar-pago-2.feature']!).toBe(3);
    expect([...zip.values()].join('\n')).toContain('    Entonces se avisa al cliente\n');
    const stored = await exportsModel(app.mongo).findById(id).lean<ExportDoc>();
    expect(stored!.fileKey).toBe(`projects/${projectId}/exports/${id}.zip`);
  });

  it('sin detalles validados: un ZIP con un LEEME.txt y la cabecera X-Export-Empty', async () => {
    const response = await request(emptyProjectId);
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-export-empty']).toBe('true');
    const zip = await unzip(response.rawPayload);
    expect([...zip.keys()]).toEqual(['LEEME.txt']);
    expect(zip.get('LEEME.txt')).toContain('Incluir pendientes');

    const pending = await request(emptyProjectId, { options: { includePending: true } });
    expect(summary(await unzip(pending.rawPayload))).toEqual({ 'validar-pago.feature': 1 });
  });
});
