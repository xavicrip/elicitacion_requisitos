import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogsModel } from '../../src/modules/audit/model';
import { versionsModel } from '../../src/modules/diagrams/models/version';
import { projectsModel } from '../../src/modules/projects/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import {
  DIAGRAM_FLAGS,
  fixture,
  multipart,
  uploadDiagram,
  uploadVersion,
} from '../helpers/diagrams';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

let app: FastifyInstance;
let adminUser: TestUser;
let admin: Record<string, string>;
let participant: Record<string, string>;
const logs: string[] = [];

beforeAll(async () => {
  const logStream = new Writable({
    write(chunk, _encoding, done) {
      logs.push(chunk.toString());
      done();
    },
  });
  ({ app } = await buildTestApp('diagramsupload', {
    withAuth: true,
    featureFlags: DIAGRAM_FLAGS,
    logStream,
  }));
  await app.ready();
  adminUser = await registerTestUser(app, 'Admin');
  admin = authHeaders(adminUser);
  participant = authHeaders(await registerTestUser(app, 'Pablo'));
});

afterAll(() => closeTestApp(app));

const newProject = (status: 'draft' | 'open' | 'closed' = 'open') =>
  seedProject(app, { status, members: [[adminUser, 'admin']] });

/** Claves del bucket bajo el prefijo del proyecto. */
const objectKeys = (projectId: string) => app.storage.listKeys(`projects/${projectId}/`);

/** PNG real de unos 3 MB (ruido: no se comprime). */
async function noisyPng(bytes: number): Promise<Buffer> {
  const side = Math.ceil(Math.sqrt(bytes / 3));
  const raw = Buffer.alloc(side * side * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width: side, height: side, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

describe('POST /projects/:projectId/diagrams (US1)', () => {
  it('un PNG de 3 MB crea la versión 1 en borrador con sus tres objetos en el bucket', async () => {
    const projectId = await newProject();
    const buffer = await noisyPng(3 * 1024 * 1024);
    expect(buffer.length).toBeGreaterThan(2.5 * 1024 * 1024);

    const response = await uploadDiagram(app, admin, projectId, { file: 'ruido.png', buffer });
    expect(response.statusCode).toBe(201);
    const version = response.json();
    expect(version).toMatchObject({ number: 1, status: 'draft' });

    const prefix = `projects/${projectId}/diagrams/${version.id}/`;
    expect((await objectKeys(projectId)).sort()).toEqual(
      [`${prefix}display.webp`, `${prefix}original.png`, `${prefix}thumb.webp`].sort(),
    );
  });

  it('registra la subida en el log con tamaño, dimensiones y duración junto al requestId', async () => {
    const projectId = await newProject();
    const { id } = (await uploadDiagram(app, admin, projectId)).json();
    const entry = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === 'Imagen de diagrama procesada' && line.versionId === id);
    expect(entry).toMatchObject({
      bytes: fixture('compra-simple.png').length,
      width: 900,
      height: 1200,
      reqId: expect.any(String),
    });
    expect(entry?.durationMs).toEqual(expect.any(Number));
  });

  it('> 10 MB → 413 "Máximo 10 MB" sin escribir en el bucket ni en la base de datos', async () => {
    const projectId = await newProject();
    const buffer = Buffer.concat([
      fixture('compra-simple.png'),
      Buffer.alloc(10 * 1024 * 1024 + 1),
    ]);
    const response = await uploadDiagram(app, admin, projectId, { file: 'grande.png', buffer });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(response.json().message).toContain('Máximo 10 MB');
    expect(await objectKeys(projectId)).toEqual([]);
    expect(
      await app.mongo
        .collection('diagrams')
        .countDocuments({ projectId: new Types.ObjectId(projectId) }),
    ).toBe(0);
  });

  it('PDF → 415 con los formatos admitidos', async () => {
    const projectId = await newProject();
    const response = await uploadDiagram(app, admin, projectId, {
      file: 'doc.png',
      buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<< >>\nendobj\n%%EOF'),
    });
    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    expect(response.json().message).toMatch(/PNG.*JPG.*SVG/);
    expect(await objectKeys(projectId)).toEqual([]);
  });

  it('SVG con script: no se guarda el SVG y la imagen servida es WebP sin el script', async () => {
    const projectId = await newProject();
    const response = await uploadDiagram(app, admin, projectId, { file: 'con-script.svg' });
    expect(response.statusCode).toBe(201);
    const keys = await objectKeys(projectId);
    expect(keys.some((key) => key.endsWith('.svg'))).toBe(false);
    const display = await app.inject({
      url: response.json().image.displayUrl.replace(/^\/api/, ''),
      headers: admin,
    });
    expect(display.headers['content-type']).toBe('image/webp');
    expect(display.rawPayload.includes('<script')).toBe(false);
  });

  it('una imagen de 12 000 px se muestra a 8192 px como máximo', async () => {
    const projectId = await newProject();
    const response = await uploadDiagram(app, admin, projectId, { file: 'enorme-12000.png' });
    expect(response.json().image).toMatchObject({ width: 8192, height: 1024 });
  });

  it('sin archivo o sin nombre → 400', async () => {
    const projectId = await newProject();
    const noFile = multipart({ name: 'Sin archivo' });
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/diagrams`,
      headers: { ...admin, ...noFile.headers },
      payload: noFile.payload,
    });
    expect(response.statusCode).toBe(400);
    expect((await uploadDiagram(app, admin, projectId, { name: '  ' })).statusCode).toBe(400);
  });

  it('un Participante recibe 403 y un proyecto cerrado 409, sin procesar la imagen', async () => {
    const pablo = await registerTestUser(app, 'Pablo');
    const projectId = await seedProject(app, {
      status: 'open',
      members: [
        [adminUser, 'admin'],
        [pablo, 'participant'],
      ],
    });
    expect((await uploadDiagram(app, authHeaders(pablo), projectId)).statusCode).toBe(403);

    const closed = await newProject('closed');
    const response = await uploadDiagram(app, admin, closed);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PROJECT_CLOSED' });
    expect(await objectKeys(closed)).toEqual([]);
  });

  it('en un proyecto en borrador también se puede subir (plan ajuste 5)', async () => {
    expect((await uploadDiagram(app, admin, await newProject('draft'))).statusCode).toBe(201);
  });

  it('actualiza lastActivityAt y audita diagram.created', async () => {
    const projectId = await newProject();
    const before = new Date();
    const response = await uploadDiagram(app, admin, projectId);
    const project = await projectsModel(app.mongo).findById(projectId);
    expect(project!.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    const audit = await auditLogsModel(app.mongo).findOne({
      action: 'diagram.created',
      projectId: new Types.ObjectId(projectId),
    });
    expect(audit).toMatchObject({
      actorId: new Types.ObjectId(adminUser.id),
      entity: { type: 'diagram', id: response.json().diagramId },
    });
  });

  it('una no-miembro recibe 404', async () => {
    const projectId = await newProject();
    expect((await uploadDiagram(app, participant, projectId)).statusCode).toBe(404);
  });
});

describe('POST /diagrams/:diagramId/versions (US1)', () => {
  it('con un borrador pendiente → 409 DRAFT_EXISTS sin dejar objetos huérfanos', async () => {
    const projectId = await newProject();
    const first = (await uploadDiagram(app, admin, projectId)).json();
    const response = await uploadVersion(app, admin, first.diagramId);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'DRAFT_EXISTS' });
    expect(await objectKeys(projectId)).toHaveLength(3);
  });

  it('dos subidas simultáneas: solo una crea el borrador y la otra no deja objetos', async () => {
    const projectId = await newProject();
    const first = (await uploadDiagram(app, admin, projectId)).json();
    await versionsModel(app.mongo).updateOne({ _id: first.id }, { $set: { status: 'published' } });

    const responses = await Promise.all([
      uploadVersion(app, admin, first.diagramId),
      uploadVersion(app, admin, first.diagramId),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await objectKeys(projectId)).toHaveLength(6);
    const drafts = await versionsModel(app.mongo).countDocuments({
      diagramId: new Types.ObjectId(first.diagramId),
      status: 'draft',
    });
    expect(drafts).toBe(1);
  });

  it('audita diagram.version_uploaded con el número de versión', async () => {
    const projectId = await newProject();
    const first = (await uploadDiagram(app, admin, projectId)).json();
    await versionsModel(app.mongo).updateOne({ _id: first.id }, { $set: { status: 'published' } });
    const second = (await uploadVersion(app, admin, first.diagramId)).json();
    const audit = await auditLogsModel(app.mongo).findOne({
      action: 'diagram.version_uploaded',
      'entity.id': second.id,
    });
    expect(audit?.diff).toMatchObject({ number: 2 });
  });

  it('un diagrama inexistente → 404', async () => {
    const response = await uploadVersion(app, admin, new Types.ObjectId().toHexString());
    expect(response.statusCode).toBe(404);
  });
});
