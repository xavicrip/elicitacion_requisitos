import { DetailSchema, HistoryEntrySchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { createDetail, DETAIL_FLAGS, publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser } from '../helpers/users';

// Contrato: PATCH/DELETE /details/{id} y GET /details/{id}/history.
const ErrorSchema = z.object({ code: z.string(), message: z.string() });

let app: FastifyInstance;
let admin: Record<string, string>;
let diagramId: string;
let key: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('detailseditcontract', {
    withAuth: true,
    featureFlags: DETAIL_FLAGS,
  }));
  await app.ready();
  const user = await registerTestUser(app);
  admin = authHeaders(user);
  const projectId = await seedProject(app, { status: 'open', members: [[user, 'admin']] });
  const diagram = await publishedDiagram(app, admin, projectId);
  diagramId = diagram.diagramId;
  key = diagram.keys['Validar pago']!;
});

afterAll(() => closeTestApp(app));

const create = async () => (await createDetail(app, admin, diagramId, key)).json();
const patch = (id: string, headers: Record<string, string>, payload: object) =>
  app.inject({ method: 'PATCH', url: `/details/${id}`, headers, payload });

describe('/details/{detailId}', () => {
  it('PATCH 200 con If-Match devuelve el Detail y el nuevo ETag', async () => {
    const { id } = await create();
    const response = await patch(id, { ...admin, 'if-match': '"0"' }, { then: 'responde en 3 s' });
    expect(response.statusCode).toBe(200);
    expect(DetailSchema.strict().parse(response.json())).toMatchObject({ rev: 1 });
    expect(response.headers.etag).toBe('"1"');
  });

  it('PATCH 409 devuelve el Detail actual; 428 sin If-Match', async () => {
    const { id } = await create();
    const stale = await patch(id, { ...admin, 'if-match': '"5"' }, { then: 'responde en 3 s' });
    expect(stale.statusCode).toBe(409);
    expect(DetailSchema.strict().parse(stale.json())).toMatchObject({ id, rev: 0 });
    const missing = await patch(id, admin, { then: 'responde en 3 s' });
    expect(missing.statusCode).toBe(428);
    ErrorSchema.parse(missing.json());
  });

  it('DELETE 204', async () => {
    const { id } = await create();
    const response = await app.inject({ method: 'DELETE', url: `/details/${id}`, headers: admin });
    expect(response.statusCode).toBe(204);
  });
});

describe('/details/{detailId}/history', () => {
  it('GET 200 devuelve las versiones anteriores', async () => {
    const { id } = await create();
    await patch(id, { ...admin, 'if-match': '"0"' }, { then: 'responde en 3 s' });
    const response = await app.inject({ url: `/details/${id}/history`, headers: admin });
    expect(response.statusCode).toBe(200);
    const [entry] = z.array(HistoryEntrySchema.strict()).length(1).parse(response.json());
    expect(entry).toMatchObject({ rev: 0, change: 'edit' });
  });
});
