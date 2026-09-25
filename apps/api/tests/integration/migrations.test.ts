import { MongoClient, type Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsStatus, runMigrations } from '../../src/db/migrations';
import { MONGO_TEST_URL, uniqueDbName } from '../helpers/services';

const dbName = uniqueDbName('migrations');
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  client = await MongoClient.connect(MONGO_TEST_URL);
  db = client.db(dbName);
});

afterAll(async () => {
  await db.dropDatabase();
  await client.close();
});

async function schemaDoc() {
  return db.collection<{ _id: string; version: number }>('_platform').findOne({ _id: 'schema' });
}

describe('migraciones', () => {
  it('up → down → up deja el esquema consistente', async () => {
    await runMigrations('up', { url: MONGO_TEST_URL, dbName });
    expect(await schemaDoc()).toMatchObject({ version: 1 });
    expect(
      (await migrationsStatus({ url: MONGO_TEST_URL, dbName })).every(
        (m) => m.appliedAt !== 'PENDING',
      ),
    ).toBe(true);

    await runMigrations('down', { url: MONGO_TEST_URL, dbName });
    expect(await schemaDoc()).toBeNull();
    expect(
      (await migrationsStatus({ url: MONGO_TEST_URL, dbName })).some(
        (m) => m.appliedAt === 'PENDING',
      ),
    ).toBe(true);

    await runMigrations('up', { url: MONGO_TEST_URL, dbName });
    expect(await schemaDoc()).toMatchObject({ version: 1 });
  });

  it('up es idempotente (volver a ejecutarlo no aplica nada nuevo)', async () => {
    const applied = await runMigrations('up', { url: MONGO_TEST_URL, dbName });
    expect(applied).toEqual([]);
  });
});

describe('lock de migraciones', () => {
  it('rechaza una ejecución concurrente mientras hay un lock activo', async () => {
    await db
      .collection<{ _id: string; createdAt: Date }>('changelog_lock')
      .insertOne({ _id: 'migrations', createdAt: new Date() });
    await expect(runMigrations('up', { url: MONGO_TEST_URL, dbName })).rejects.toThrow(
      /otra ejecución/,
    );
    await db.collection<{ _id: string }>('changelog_lock').deleteOne({ _id: 'migrations' });
  });
});
