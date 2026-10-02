import { DescriptiveDashboardSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { createDetail, publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser } from '../helpers/users';

// Contrato: specs/007-dashboard-analitico/contracts/dashboard.openapi.yaml (respuestas estrictas:
// ningún campo fuera del contrato compartido en `packages/shared`). Cada historia añade aquí sus
// rutas (constitución III).

let app: FastifyInstance;
let admin: Record<string, string>;
let projectId: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('dashboardcontract', {
    withAuth: true,
    featureFlags: 'dashboard=true',
  }));
  await app.ready();
  const user = await registerTestUser(app);
  admin = authHeaders(user);
  projectId = await seedProject(app, { status: 'open', members: [[user, 'admin']] });
  const diagram = await publishedDiagram(app, admin, projectId);
  await createDetail(app, admin, diagram.diagramId, diagram.keys['Validar pago']!);
});
afterAll(() => closeTestApp(app));

const Count = z.strictObject({ key: z.string(), label: z.string(), count: z.number().int() });
const StrictDescriptive = z.strictObject({
  kpis: z.strictObject(DescriptiveDashboardSchema.shape.kpis.shape),
  byActivity: z.array(Count),
  byType: z.array(Count),
  byPriority: z.array(Count),
  byRole: z.array(Count),
  byStatus: z.array(Count),
  timeline: z.array(z.strictObject(DescriptiveDashboardSchema.shape.timeline.element.shape)),
});

describe('GET /projects/{projectId}/dashboard/descriptive', () => {
  it('200 cumple Descriptive (estricto)', async () => {
    const response = await app.inject({
      url: `/projects/${projectId}/dashboard/descriptive?type=non_functional&status=pending`,
      headers: admin,
    });
    expect(response.statusCode).toBe(200);
    expect(StrictDescriptive.safeParse(response.json()).error?.issues ?? []).toEqual([]);
    expect(response.json().kpis.totalDetails).toBe(1);
  });

  it('400 con un filtro inválido sigue el formato de errores', async () => {
    const response = await app.inject({
      url: `/projects/${projectId}/dashboard/descriptive?from=ayer`,
      headers: admin,
    });
    expect(response.statusCode).toBe(400);
    expect(
      z
        .strictObject({
          code: z.literal('VALIDATION_ERROR'),
          message: z.string(),
          fields: z.record(z.string(), z.string()),
        })
        .safeParse(response.json()).success,
    ).toBe(true);
  });
});
