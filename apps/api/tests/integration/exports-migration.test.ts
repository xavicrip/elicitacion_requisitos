import { MongoClient, ObjectId, type Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/db/migration-config';
import { migrationsStatus, runMigrations } from '../../src/db/migrations';
import { MONGO_TEST_URL, uniqueDbName } from '../helpers/services';

const FILE = '20261105000000-exports-indexes.js';
const dbName = uniqueDbName('exports_migration');
const target = { url: MONGO_TEST_URL, dbName };
let client: MongoClient;
let db: Db;

async function indexes() {
  const all = await db
    .collection('exports')
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

// `up` aplica todas las migraciones: con cobertura y en paralelo supera los 5 s por defecto.
describe(`migración ${FILE} (data-model.md §Migración)`, { timeout: 30_000 }, () => {
  it('no es destructiva', async () => {
    const migration = (await import(`${MIGRATIONS_DIR}/${FILE}`)) as { destructive: unknown };
    expect(migration.destructive).toBe(false);
  });

  it('up crea los índices del historial, de la limpieza y de la exportación en curso', async () => {
    await runMigrations('up', target);
    expect(await indexes()).toMatchObject({
      projectId_createdAt: { key: { projectId: 1, createdAt: -1 } },
      expiresAt_with_file: {
        key: { expiresAt: 1 },
        partialFilterExpression: { fileKey: { $type: 'string' } },
      },
      projectId_format_active_unique: {
        key: { projectId: 1, format: 1 },
        unique: true,
        partialFilterExpression: { status: { $in: ['pending', 'running'] } },
      },
    });
  });

  it('como máximo una exportación en curso por proyecto y formato', async () => {
    const exports = db.collection('exports');
    const projectId = new ObjectId();
    await exports.insertOne({ projectId, format: 'pdf', status: 'done' });
    await exports.insertOne({ projectId, format: 'pdf', status: 'failed' });
    await exports.insertOne({ projectId, format: 'pdf', status: 'pending' });
    await expect(
      exports.insertOne({ projectId, format: 'pdf', status: 'running' }),
    ).rejects.toThrow(/duplicate key/);
    await exports.insertOne({ projectId, format: 'xlsx', status: 'running' });
    await exports.insertOne({ projectId: new ObjectId(), format: 'pdf', status: 'running' });
  });

  it('down elimina los índices y conserva los datos; up → down → up es repetible', async () => {
    while (
      (await migrationsStatus(target)).find((m) => m.fileName === FILE)?.appliedAt !== 'PENDING'
    ) {
      await runMigrations('down', target);
    }
    expect(await indexes()).toEqual({});
    expect(await db.collection('exports').countDocuments()).toBe(5);
    await runMigrations('up', target);
    expect(Object.keys(await indexes())).toContain('projectId_format_active_unique');
  });
});
