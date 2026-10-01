import { MongoClient, type Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/db/migration-config';
import { migrationsStatus, runMigrations } from '../../src/db/migrations';
import { MONGO_TEST_URL, uniqueDbName } from '../helpers/services';

const FILE = '20261015000000-details-indexes.js';
const COLLECTIONS = ['details', 'detail_votes', 'detail_comments', 'detail_history'];
const dbName = uniqueDbName('details_migration');
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

  it('up crea los índices de detalles, votos, comentarios e historial', async () => {
    await runMigrations('up', target);
    expect(await indexes('details')).toMatchObject({
      diagram_activity_status: { key: { diagramId: 1, activityKey: 1, status: 1 } },
      diagram_activity_votes: {
        key: { diagramId: 1, activityKey: 1, voteCount: -1, createdAt: -1 },
      },
      projectId_createdAt: { key: { projectId: 1, createdAt: 1 } },
      projectId_status: { key: { projectId: 1, status: 1 } },
      scenario_text: { default_language: 'spanish' },
    });
    expect(await indexes('detail_votes')).toMatchObject({
      detailId_userId_unique: { key: { detailId: 1, userId: 1 }, unique: true },
      projectId: { key: { projectId: 1 } },
    });
    expect(await indexes('detail_comments')).toMatchObject({
      detailId_createdAt: { key: { detailId: 1, createdAt: 1 } },
      projectId: { key: { projectId: 1 } },
    });
    expect(await indexes('detail_history')).toMatchObject({
      detailId_rev: { key: { detailId: 1, rev: 1 } },
      projectId: { key: { projectId: 1 } },
    });
  });

  it('un miembro solo vota una vez cada detalle', async () => {
    const votes = db.collection('detail_votes');
    await votes.insertOne({ detailId: 'd1', userId: 'u1', projectId: 'p1' });
    await expect(
      votes.insertOne({ detailId: 'd1', userId: 'u1', projectId: 'p1' }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('el índice de texto busca en español sobre Dado, Cuando y Entonces', async () => {
    await db.collection('details').insertOne({
      projectId: 'p1',
      given: 'el cliente tiene productos',
      when: 'paga con tarjetas',
      then: 'confirma el pago',
    });
    const found = await db
      .collection('details')
      .find({ $text: { $search: 'tarjeta' } })
      .toArray();
    expect(found).toHaveLength(1);
  });

  it('down elimina los índices y conserva los datos; up → down → up es repetible', async () => {
    while (
      (await migrationsStatus(target)).find((m) => m.fileName === FILE)?.appliedAt !== 'PENDING'
    ) {
      await runMigrations('down', target);
    }
    for (const name of COLLECTIONS) expect(await indexes(name)).toEqual({});
    expect(await db.collection('detail_votes').countDocuments()).toBe(1);
    await runMigrations('up', target);
    expect(Object.keys(await indexes('details'))).toContain('scenario_text');
  });
});
