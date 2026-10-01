import { DetailSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { detailsModel } from '../../src/modules/details/models/detail';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { createDetail, DETAIL_FLAGS, publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser } from '../helpers/users';

// Contrato: moderación, reasignación y huérfanos.
const ErrorSchema = z.object({ code: z.string(), message: z.string() });

let app: FastifyInstance;
let admin: Record<string, string>;
let projectId: string;
let diagram: Awaited<ReturnType<typeof publishedDiagram>>;

beforeAll(async () => {
  ({ app } = await buildTestApp('moderationcontract', {
    withAuth: true,
    featureFlags: DETAIL_FLAGS,
  }));
  await app.ready();
  const user = await registerTestUser(app);
  admin = authHeaders(user);
  projectId = await seedProject(app, { status: 'open', members: [[user, 'admin']] });
  diagram = await publishedDiagram(app, admin, projectId);
});

afterAll(() => closeTestApp(app));

const create = async () =>
  (await createDetail(app, admin, diagram.diagramId, diagram.keys['Validar pago']!)).json();

describe('/details/{detailId}/status', () => {
  it('POST 200 devuelve el Detail moderado', async () => {
    const { id } = await create();
    const response = await app.inject({
      method: 'POST',
      url: `/details/${id}/status`,
      headers: admin,
      payload: { status: 'validated' },
    });
    expect(response.statusCode).toBe(200);
    expect(DetailSchema.strict().parse(response.json()).status).toBe('validated');
  });

  it('POST 422 con el formato de error si el original no es válido', async () => {
    const { id } = await create();
    const response = await app.inject({
      method: 'POST',
      url: `/details/${id}/status`,
      headers: admin,
      payload: { status: 'duplicate', duplicateOf: id },
    });
    expect(response.statusCode).toBe(422);
    ErrorSchema.parse(response.json());
  });
});

describe('/details/{detailId}/reassign y /projects/{projectId}/details/orphans', () => {
  it('GET 200 lista los huérfanos y POST 200 los reasigna', async () => {
    const { id } = await create();
    await detailsModel(app.mongo).updateOne(
      { _id: id },
      { $set: { activityKey: crypto.randomUUID() } },
    );
    const orphans = await app.inject({
      url: `/projects/${projectId}/details/orphans`,
      headers: admin,
    });
    expect(orphans.statusCode).toBe(200);
    expect(z.array(DetailSchema.strict()).length(1).parse(orphans.json())[0]!.id).toBe(id);

    const response = await app.inject({
      method: 'POST',
      url: `/details/${id}/reassign`,
      headers: admin,
      payload: { diagramId: diagram.diagramId, activityKey: diagram.keys['Emitir factura'] },
    });
    expect(response.statusCode).toBe(200);
    expect(DetailSchema.strict().parse(response.json()).activityKey).toBe(
      diagram.keys['Emitir factura'],
    );
  });
});
