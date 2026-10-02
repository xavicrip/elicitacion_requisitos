import { MongoClient, ObjectId, type Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/db/migration-config';
import { migrationsStatus, runMigrations } from '../../src/db/migrations';
import { MONGO_TEST_URL, uniqueDbName } from '../helpers/services';

const FILE = '20261029000000-analysis-indexes.js';
const COLLECTIONS = [
  'analysis_runs',
  'duplicate_decisions',
  'insight_feedback',
  'analysis_settings',
];
const dbName = uniqueDbName('analysis_migration');
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

  it('up crea los índices de runs, decisiones, valoraciones y ajustes', async () => {
    await runMigrations('up', target);
    expect(await indexes('analysis_runs')).toMatchObject({
      projectId_createdAt: { key: { projectId: 1, createdAt: -1 } },
      projectId_active_unique: {
        key: { projectId: 1 },
        unique: true,
        partialFilterExpression: { status: { $in: ['pending', 'running'] } },
      },
    });
    expect(await indexes('duplicate_decisions')).toMatchObject({
      projectId_pair_unique: { key: { projectId: 1, pair: 1 }, unique: true },
    });
    expect(await indexes('insight_feedback')).toMatchObject({
      projectId_runId: { key: { projectId: 1, runId: 1 } },
    });
    expect(await indexes('analysis_settings')).toMatchObject({
      projectId_unique: { key: { projectId: 1 }, unique: true },
    });
  });

  it('como máximo un análisis pending o running por proyecto; los terminados no cuentan', async () => {
    const runs = db.collection('analysis_runs');
    const projectId = new ObjectId();
    await runs.insertOne({ projectId, status: 'done' });
    await runs.insertOne({ projectId, status: 'failed' });
    await runs.insertOne({ projectId, status: 'pending' });
    await expect(runs.insertOne({ projectId, status: 'running' })).rejects.toThrow(/duplicate key/);
    await runs.insertOne({ projectId: new ObjectId(), status: 'running' });
  });

  it('un par de detalles se decide una sola vez por proyecto', async () => {
    const decisions = db.collection('duplicate_decisions');
    const projectId = new ObjectId();
    await decisions.insertOne({ projectId, pair: ['a', 'b'], decision: 'rejected' });
    await expect(
      decisions.insertOne({ projectId, pair: ['a', 'b'], decision: 'confirmed' }),
    ).rejects.toThrow(/duplicate key/);
    await decisions.insertOne({
      projectId: new ObjectId(),
      pair: ['a', 'b'],
      decision: 'rejected',
    });
  });

  it('down elimina los índices y conserva los datos; up → down → up es repetible', async () => {
    while (
      (await migrationsStatus(target)).find((m) => m.fileName === FILE)?.appliedAt !== 'PENDING'
    ) {
      await runMigrations('down', target);
    }
    for (const name of COLLECTIONS) expect(await indexes(name)).toEqual({});
    expect(await db.collection('analysis_runs').countDocuments()).toBe(4);
    await runMigrations('up', target);
    expect(Object.keys(await indexes('analysis_runs'))).toContain('projectId_active_unique');
  });
});
