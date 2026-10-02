import { MongoClient, ObjectId, type Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/db/migration-config';
import { migrationsStatus, runMigrations } from '../../src/db/migrations';
import { MONGO_TEST_URL, uniqueDbName } from '../helpers/services';

const FILE = '20261022000000-detection-indexes.js';
const COLLECTIONS = ['detection_jobs', 'activity_proposals', 'transition_proposals'];
const dbName = uniqueDbName('detection_migration');
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

describe(`migración ${FILE} (data-model.md §Migración)`, () => {
  it('no es destructiva', async () => {
    const migration = (await import(`${MIGRATIONS_DIR}/${FILE}`)) as { destructive: unknown };
    expect(migration.destructive).toBe(false);
  });

  it('up crea los índices de jobs y propuestas', async () => {
    await runMigrations('up', target);
    expect(await indexes('detection_jobs')).toMatchObject({
      versionId_createdAt: { key: { versionId: 1, createdAt: -1 } },
      versionId_active_unique: {
        key: { versionId: 1 },
        unique: true,
        partialFilterExpression: { status: { $in: ['pending', 'running'] } },
      },
      projectId: { key: { projectId: 1 } },
    });
    for (const collection of ['activity_proposals', 'transition_proposals']) {
      expect(await indexes(collection)).toMatchObject({
        versionId_status: { key: { versionId: 1, status: 1 } },
        jobId: { key: { jobId: 1 } },
        projectId: { key: { projectId: 1 } },
      });
    }
  });

  it('como máximo un job pending o running por versión; los terminados no cuentan', async () => {
    const jobs = db.collection('detection_jobs');
    const versionId = new ObjectId();
    await jobs.insertOne({ versionId, status: 'done' });
    await jobs.insertOne({ versionId, status: 'failed' });
    await jobs.insertOne({ versionId, status: 'pending' });
    await expect(jobs.insertOne({ versionId, status: 'running' })).rejects.toThrow(/duplicate key/);
    await jobs.insertOne({ versionId: new ObjectId(), status: 'running' });
  });

  it('down elimina los índices y conserva los datos; up → down → up es repetible', async () => {
    while (
      (await migrationsStatus(target)).find((m) => m.fileName === FILE)?.appliedAt !== 'PENDING'
    ) {
      await runMigrations('down', target);
    }
    for (const name of COLLECTIONS) expect(await indexes(name)).toEqual({});
    expect(await db.collection('detection_jobs').countDocuments()).toBe(4);
    await runMigrations('up', target);
    expect(Object.keys(await indexes('detection_jobs'))).toContain('versionId_active_unique');
  });
});
