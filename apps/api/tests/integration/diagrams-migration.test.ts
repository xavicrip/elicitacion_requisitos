import { MongoClient, type Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/db/migration-config';
import { migrationsStatus, runMigrations } from '../../src/db/migrations';
import { MONGO_TEST_URL, uniqueDbName } from '../helpers/services';

const FILE = '20261008000000-diagrams-indexes.js';
const dbName = uniqueDbName('diagrams_migration');
const target = { url: MONGO_TEST_URL, dbName };
let client: MongoClient;
let db: Db;

async function indexes(collection: string) {
  const all = await db
    .collection(collection)
    .indexes()
    .catch(() => []);
  return Object.fromEntries(
    all.filter((index) => index.name !== '_id_').map((index) => [index.name, index]),
  );
}

beforeAll(async () => {
  client = await MongoClient.connect(MONGO_TEST_URL);
  db = client.db(dbName);
});

afterAll(async () => {
  await db.dropDatabase();
  await client.close();
});

// `up` aplica todas las migraciones (crecen con cada feature): con cobertura y las pruebas en
// paralelo del CI supera los 5 s por defecto, y un timeout deja el bloqueo de migraciones tomado.
describe(`migración ${FILE} (data-model.md §Migración)`, { timeout: 30_000 }, () => {
  it('no es destructiva', async () => {
    const migration = (await import(`${MIGRATIONS_DIR}/${FILE}`)) as { destructive: unknown };
    expect(migration.destructive).toBe(false);
  });

  it('up crea los índices de diagramas, versiones y actividades', async () => {
    await runMigrations('up', target);
    expect(await indexes('diagrams')).toMatchObject({
      projectId_order: { key: { projectId: 1, order: 1 } },
    });
    expect(await indexes('diagram_versions')).toMatchObject({
      diagramId_number_unique: { key: { diagramId: 1, number: 1 }, unique: true },
      diagramId_published_unique: {
        key: { diagramId: 1 },
        unique: true,
        partialFilterExpression: { status: 'published' },
      },
      diagramId_draft_unique: {
        key: { diagramId: 1 },
        unique: true,
        partialFilterExpression: { status: 'draft' },
      },
      projectId: { key: { projectId: 1 } },
    });
    expect(await indexes('activities')).toMatchObject({
      versionId_key_unique: { key: { versionId: 1, key: 1 }, unique: true },
      projectId: { key: { projectId: 1 } },
    });
  });

  it('solo puede haber un borrador y una versión publicada por diagrama; archivadas, varias', async () => {
    const versions = db.collection('diagram_versions');
    const base = { diagramId: 'd1', projectId: 'p1' };
    await versions.insertMany([
      { ...base, number: 1, status: 'archived' },
      { ...base, number: 2, status: 'archived' },
      { ...base, number: 3, status: 'published' },
      { ...base, number: 4, status: 'draft' },
    ]);
    await expect(versions.insertOne({ ...base, number: 5, status: 'draft' })).rejects.toThrow(
      /duplicate key/,
    );
    await expect(versions.insertOne({ ...base, number: 5, status: 'published' })).rejects.toThrow(
      /duplicate key/,
    );
    await expect(versions.insertOne({ ...base, number: 4, status: 'archived' })).rejects.toThrow(
      /duplicate key/,
    );
  });

  it('ante dos subidas simultáneas solo se crea un borrador', async () => {
    const versions = db.collection('diagram_versions');
    const results = await Promise.allSettled(
      [1, 2].map((number) =>
        versions.insertOne({ diagramId: 'd2', projectId: 'p1', number, status: 'draft' }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await versions.deleteMany({ diagramId: 'd2' });
  });

  it('down elimina los índices y conserva los datos; up → down → up es repetible', async () => {
    // `down` revierte una migración cada vez: las posteriores a esta también se revierten.
    while (
      (await migrationsStatus(target)).find((m) => m.fileName === FILE)?.appliedAt !== 'PENDING'
    ) {
      await runMigrations('down', target);
    }
    for (const name of ['diagrams', 'diagram_versions', 'activities']) {
      expect(await indexes(name)).toEqual({});
    }
    expect(await db.collection('diagram_versions').countDocuments()).toBe(4);
    const status = await migrationsStatus(target);
    expect(status.find((m) => m.fileName === FILE)?.appliedAt).toBe('PENDING');

    await runMigrations('up', target);
    expect(Object.keys(await indexes('activities'))).toContain('versionId_key_unique');
  });
});
