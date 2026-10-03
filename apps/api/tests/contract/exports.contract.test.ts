import { ExportSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { exportsModel } from '../../src/modules/exports/models/export';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Contrato: specs/008-exportacion-resultados/contracts/exports.openapi.yaml (respuestas
// estrictas: ningún campo fuera del contrato compartido en `packages/shared`). Cada historia
// añade aquí sus rutas (constitución III).

let app: FastifyInstance;
let user: TestUser;
let admin: Record<string, string>;
let projectId: string;
let exportId: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('exportscontract', {
    withAuth: true,
    featureFlags: 'exports=true',
  }));
  await app.ready();
  user = await registerTestUser(app);
  admin = authHeaders(user);
  projectId = await seedProject(app, { status: 'open', members: [[user, 'admin']] });
  const created = await exportsModel(app.mongo).create({
    projectId: new Types.ObjectId(projectId),
    format: 'xlsx',
    options: { delimiter: 'comma', includePending: false },
    filters: { diagramIds: null, from: null, to: null, types: null, statuses: ['validated'] },
    mode: 'async',
    status: 'done',
    detailCount: 1200,
    fileKey: `projects/${projectId}/exports/x.xlsx`,
    fileName: 'reqcanvas-proyecto-20261003-1000.xlsx',
    bytes: 4096,
    requestedBy: new Types.ObjectId(user.id),
    finishedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });
  exportId = created._id.toHexString();
});
afterAll(() => closeTestApp(app));

const StrictExport = z.strictObject({
  ...ExportSchema.shape,
  error: z.strictObject({ code: z.string(), message: z.string() }).nullable(),
});
const StrictError = z.strictObject({ code: z.string(), message: z.string() });

describe('GET /projects/{projectId}/exports', () => {
  it('200 devuelve una lista de Export (estricto)', async () => {
    const response = await app.inject({ url: `/projects/${projectId}/exports`, headers: admin });
    expect(response.statusCode).toBe(200);
    expect(z.array(StrictExport).safeParse(response.json()).error?.issues ?? []).toEqual([]);
    expect(response.json()).toHaveLength(1);
  });

  it('401 sin sesión sigue el formato de errores', async () => {
    const response = await app.inject({ url: `/projects/${projectId}/exports` });
    expect(response.statusCode).toBe(401);
    expect(StrictError.safeParse(response.json()).success).toBe(true);
  });
});

describe('GET /exports/{exportId}', () => {
  it('200 cumple Export (estricto)', async () => {
    const response = await app.inject({ url: `/exports/${exportId}`, headers: admin });
    expect(response.statusCode).toBe(200);
    expect(StrictExport.safeParse(response.json()).error?.issues ?? []).toEqual([]);
    expect(response.json()).toMatchObject({
      id: exportId,
      projectId,
      format: 'xlsx',
      mode: 'async',
      status: 'done',
      expired: false,
      detailCount: 1200,
      bytes: 4096,
      error: null,
    });
  });

  it('404 si no existe', async () => {
    const response = await app.inject({
      url: `/exports/${new Types.ObjectId().toHexString()}`,
      headers: admin,
    });
    expect(response.statusCode).toBe(404);
    expect(StrictError.safeParse(response.json()).success).toBe(true);
  });
});

describe('POST /projects/{projectId}/exports', () => {
  it('400 con un formato desconocido sigue el formato de errores', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/exports`,
      headers: admin,
      payload: { format: 'docx' },
    });
    expect(response.statusCode).toBe(400);
    expect(
      z
        .strictObject({
          code: z.literal('VALIDATION_ERROR'),
          message: z.string(),
          fields: z.record(z.string(), z.string()),
        })
        .safeParse(response.json()).error?.issues ?? [],
    ).toEqual([]);
    expect(response.json().fields).toHaveProperty('format');
  });
});
