import { ActivityCoverageSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { createDetail, publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser } from '../helpers/users';

// Contrato: GET /diagram-versions/{versionId}/coverage.

let app: FastifyInstance;
let admin: Record<string, string>;
let versionId: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('coveragecontract', {
    withAuth: true,
  }));
  await app.ready();
  const user = await registerTestUser(app);
  admin = authHeaders(user);
  const projectId = await seedProject(app, { status: 'open', members: [[user, 'admin']] });
  const diagram = await publishedDiagram(app, admin, projectId);
  versionId = diagram.versionId;
  await createDetail(app, admin, diagram.diagramId, diagram.keys['Validar pago']!);
});

afterAll(() => closeTestApp(app));

describe('/diagram-versions/{versionId}/coverage', () => {
  it('GET 200 devuelve un ActivityCoverage por actividad', async () => {
    const response = await app.inject({
      url: `/diagram-versions/${versionId}/coverage`,
      headers: admin,
    });
    expect(response.statusCode).toBe(200);
    const coverage = z.array(ActivityCoverageSchema.strict()).length(3).parse(response.json());
    expect(coverage.map((entry) => entry.total).sort()).toEqual([0, 0, 1]);
  });
});
