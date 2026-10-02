import { MongoClient, type Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/db/migration-config';
import { migrationsStatus, runMigrations } from '../../src/db/migrations';
import { MONGO_TEST_URL, uniqueDbName } from '../helpers/services';

const FILE = '20261001000000-auth-projects-indexes.js';
const dbName = uniqueDbName('auth_migration');
const target = { url: MONGO_TEST_URL, dbName };
let client: MongoClient;
let db: Db;

/** Índices de una colección, sin el `_id_`, por nombre. */
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
  it('no es destructiva: solo crea colecciones e índices', async () => {
    const migration = (await import(`${MIGRATIONS_DIR}/${FILE}`)) as { destructive: unknown };
    expect(migration.destructive).toBe(false);
  });

  it('up crea los índices únicos, TTL y de consulta', async () => {
    await runMigrations('up', target);

    expect(await indexes('users')).toMatchObject({
      email_unique: { key: { email: 1 }, unique: true },
    });
    expect(await indexes('projects')).toMatchObject({
      members_lastActivity: { key: { 'members.userId': 1, lastActivityAt: -1 } },
      status: { key: { status: 1 } },
    });
    expect(await indexes('invitations')).toMatchObject({
      tokenHash_unique: { key: { tokenHash: 1 }, unique: true },
      projectId: { key: { projectId: 1 } },
      // TTL con 30 días de gracia tras la caducidad.
      expiresAt_ttl: { key: { expiresAt: 1 }, expireAfterSeconds: 30 * 24 * 60 * 60 },
    });
    expect(await indexes('refresh_tokens')).toMatchObject({
      tokenHash_unique: { key: { tokenHash: 1 }, unique: true },
      sid: { key: { sid: 1 } },
      expiresAt_ttl: { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    });
    expect(await indexes('audit_logs')).toMatchObject({
      projectId_at: { key: { projectId: 1, at: -1 } },
    });
  });

  it('el índice único de email rechaza duplicados', async () => {
    await db.collection('users').insertOne({ email: 'ana@example.com' });
    await expect(db.collection('users').insertOne({ email: 'ana@example.com' })).rejects.toThrow(
      /duplicate key/,
    );
  });

  it('down elimina los índices pero conserva los datos (rollback sin pérdida)', async () => {
    // `down` revierte una migración cada vez: las posteriores a esta también se revierten.
    while (
      (await migrationsStatus(target)).find((m) => m.fileName === FILE)?.appliedAt !== 'PENDING'
    ) {
      await runMigrations('down', target);
    }

    for (const name of ['users', 'projects', 'invitations', 'refresh_tokens', 'audit_logs']) {
      expect(await indexes(name)).toEqual({});
    }
    // Las cuentas creadas mientras la versión estuvo desplegada no se pierden.
    expect(await db.collection('users').countDocuments({ email: 'ana@example.com' })).toBe(1);
    const status = await migrationsStatus(target);
    expect(status.find((m) => m.fileName === FILE)?.appliedAt).toBe('PENDING');
  });

  it('up → down → up es repetible y vuelve a crear los índices sobre los datos existentes', async () => {
    await runMigrations('up', target);
    expect(Object.keys(await indexes('users'))).toContain('email_unique');
  });
});
