import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrations';
import { activitiesModel } from '../../src/modules/diagrams/models/activity';
import { diagramsModel } from '../../src/modules/diagrams/models/diagram';
import { versionsModel } from '../../src/modules/diagrams/models/version';
import { MONGO_TEST_URL, uniqueDbName } from '../helpers/services';

const dbName = uniqueDbName('diagrams_models');
let connection: Connection;
const id = () => new mongoose.Types.ObjectId();
const image = {
  originalKey: 'projects/p/diagrams/v/original.png',
  displayKey: 'projects/p/diagrams/v/display.webp',
  thumbKey: 'projects/p/diagrams/v/thumb.webp',
  mime: 'image/png',
  width: 900,
  height: 1200,
  bytes: 1234,
};

beforeAll(async () => {
  await runMigrations('up', { url: MONGO_TEST_URL, dbName });
  connection = await mongoose.createConnection(MONGO_TEST_URL, { dbName }).asPromise();
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('modelos de la feature 003', () => {
  it('un diagrama nuevo no tiene versión publicada y recorta el nombre', async () => {
    const diagram = await diagramsModel(connection).create({ projectId: id(), name: '  Compra ' });
    expect(diagram.toJSON()).toMatchObject({ name: 'Compra', order: 0, publishedVersionId: null });
  });

  it('una versión nueva es un borrador con rev 0 y conserva las claves de la imagen', async () => {
    const version = await versionsModel(connection).create({
      diagramId: id(),
      projectId: id(),
      number: 1,
      image,
      createdBy: id(),
    });
    expect(version.toJSON()).toMatchObject({ status: 'draft', rev: 0, publishedAt: null, image });
  });

  it('una actividad nueva recibe una key UUID, rev 0, origen manual y sin transiciones', async () => {
    const activity = await activitiesModel(connection).create({
      versionId: id(),
      diagramId: id(),
      projectId: id(),
      label: ' Validar pago ',
      type: 'decision',
      bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
    });
    const json = activity.toJSON();
    expect(json).toMatchObject({ label: 'Validar pago', rev: 0, source: 'manual', next: [] });
    expect(json.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('la key es única dentro de una versión (índice de la migración)', async () => {
    const Activities = activitiesModel(connection);
    const base = {
      versionId: id(),
      diagramId: id(),
      projectId: id(),
      key: '0b1f5c7e-7d9a-4c0e-9d6c-2f1e3a4b5c6d',
      label: 'A',
      type: 'action' as const,
      bbox: { x: 0, y: 0, w: 0.1, h: 0.1 },
    };
    await Activities.create(base);
    await expect(Activities.create(base)).rejects.toThrow(/duplicate key/);
  });

  it('Mongoose no crea índices propios: solo los de las migraciones', async () => {
    const names = (await connection.collection('activities').indexes()).map((index) => index.name);
    expect(names.sort()).toEqual(['_id_', 'projectId', 'versionId_key_unique']);
  });
});
