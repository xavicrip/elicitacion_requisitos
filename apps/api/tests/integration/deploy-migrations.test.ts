import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Decimal128, MongoClient, ObjectId, type Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dumpDatabase,
  restoreDatabase,
  s3BackupStore,
  type BackupStore,
} from '../../src/db/backup';
import { migrationsStatus, runDeployMigrations } from '../../src/db/migrations';
import {
  MONGO_TEST_URL,
  S3_TEST_CREDENTIALS,
  S3_TEST_URL,
  uniqueDbName,
} from '../helpers/services';

const FIXTURES = fileURLToPath(new URL('../fixtures/deploy-migrations/', import.meta.url));
const CREATE_ITEMS = '20260101000000-create-items.js';
const DROP_LEGACY = '20260102000000-drop-legacy.js';

const dbName = uniqueDbName('deploy');
const bucket = dbName.replace(/_/g, '-');
const workDir = mkdtempSync(join(tmpdir(), 'reqcanvas-migrations-'));
let client: MongoClient;
let db: Db;
let store: BackupStore;

/** Directorio de migraciones de una "versión" del código con los archivos indicados. */
function codeWith(name: string, files: string[]): string {
  const dir = mkdtempSync(join(workDir, `${name}-`));
  for (const file of files) copyFileSync(join(FIXTURES, file), join(dir, file));
  return dir;
}

const target = (migrationsDir: string) => ({ url: MONGO_TEST_URL, dbName, migrationsDir });

beforeAll(async () => {
  client = await MongoClient.connect(MONGO_TEST_URL);
  db = client.db(dbName);
  const settings = {
    endpoint: S3_TEST_URL,
    bucket,
    region: 'us-east-1',
    forcePathStyle: true,
    ...S3_TEST_CREDENTIALS,
  };
  const s3 = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: true,
    credentials: S3_TEST_CREDENTIALS,
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  s3.destroy();
  store = s3BackupStore(settings);
});

afterAll(async () => {
  await db.dropDatabase();
  await client.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe('respaldo lógico', () => {
  it('dump → restore conserva documentos, tipos BSON, opciones e índices', async () => {
    const source = client.db(`${dbName}_dump`);
    const id = new ObjectId();
    await source.createCollection('capped', { capped: true, size: 4096 });
    await source.collection('things').createIndex({ code: 1 }, { unique: true, name: 'code_u' });
    await source.collection('things').insertMany([
      {
        _id: id,
        code: 'a',
        at: new Date('2026-01-01T00:00:00Z'),
        price: Decimal128.fromString('9.99'),
      },
      { code: 'b', nested: { list: [1, 2, 3] } },
    ]);
    const archive = await dumpDatabase(source);

    await source.collection('things').deleteMany({});
    await source.collection('things').insertOne({ code: 'zzz' });
    expect(await restoreDatabase(source, archive)).toEqual(
      expect.arrayContaining(['capped', 'things']),
    );

    const things = await source.collection('things').find().sort({ code: 1 }).toArray();
    expect(things.map((t) => t.code)).toEqual(['a', 'b']);
    expect(things[0]).toMatchObject({ _id: id, at: new Date('2026-01-01T00:00:00Z') });
    expect(things[0]!.price).toBeInstanceOf(Decimal128);
    const indexes = await source.collection('things').indexes();
    expect(indexes).toContainEqual(expect.objectContaining({ name: 'code_u', unique: true }));
    const [capped] = await source.listCollections({ name: 'capped' }).toArray();
    expect(capped).toMatchObject({ options: { capped: true } });
    await source.dropDatabase();
  });
});

describe('migraciones del despliegue (MIGRATION_ACTION)', () => {
  const v1 = codeWith('v1', [CREATE_ITEMS]);
  const v2 = codeWith('v2', [CREATE_ITEMS, DROP_LEGACY]);

  it('up sin migraciones destructivas no respalda', async () => {
    const result = await runDeployMigrations(target(v1), {
      action: { kind: 'up' },
      store,
      version: 'v1',
    });
    expect(result).toEqual({ applied: [CREATE_ITEMS], reverted: [] });
    await db.collection('items').insertMany([
      { sku: 'A', legacy: 'dato-a' },
      { sku: 'B', legacy: 'dato-b' },
    ]);
  });

  it('sin bucket, una migración destructiva pendiente aborta el despliegue sin aplicarla', async () => {
    await expect(
      runDeployMigrations(target(v2), { action: { kind: 'up' }, version: 'v2' }),
    ).rejects.toThrow(/destructivas pendientes.*BACKUP_S3/);
    const status = await migrationsStatus(target(v2));
    expect(status.find((m) => m.fileName === DROP_LEGACY)?.appliedAt).toBe('PENDING');
    expect(await db.collection('changelog_lock').countDocuments()).toBe(0);
  });

  it('con bucket, respalda antes de aplicar la migración destructiva', async () => {
    const result = await runDeployMigrations(target(v2), {
      action: { kind: 'up' },
      store,
      version: 'v2',
    });
    expect(result.applied).toEqual([DROP_LEGACY]);
    expect(result.backup).toMatch(/^mongo-backups\/.+-v2\.ndjson\.gz$/);
    expect(await store.latestKey()).toBe(result.backup);
    expect(await db.collection('items').countDocuments({ legacy: { $exists: true } })).toBe(0);
  });

  it('restore:latest con el código anterior recupera los datos y el changelog', async () => {
    const result = await runDeployMigrations(target(v1), {
      action: { kind: 'restore', key: 'latest' },
      store,
      version: 'v1',
    });
    expect(result.restored).toMatch(/-v2\.ndjson\.gz$/);
    expect(result.applied).toEqual([]);
    const legacy = await db.collection('items').find().sort({ sku: 1 }).toArray();
    expect(legacy.map((item) => item.legacy)).toEqual(['dato-a', 'dato-b']);
    const status = await migrationsStatus(target(v2));
    expect(status.find((m) => m.fileName === DROP_LEGACY)?.appliedAt).toBe('PENDING');
  });

  it('un redespliegue con la misma restauración no vuelve a restaurar', async () => {
    await db.collection('items').insertOne({ sku: 'C' });
    const result = await runDeployMigrations(target(v1), {
      action: { kind: 'restore', key: 'latest' },
      store,
      version: 'v1',
    });
    expect(result.restored).toBeUndefined();
    expect(await db.collection('items').countDocuments()).toBe(3);
  });

  it('down:<archivo> revierte desde esa migración y después no hace nada', async () => {
    const first = await runDeployMigrations(target(v1), {
      action: { kind: 'down', from: CREATE_ITEMS },
      version: 'v1',
    });
    expect(first).toEqual({ applied: [], reverted: [CREATE_ITEMS] });
    expect(await db.listCollections({ name: 'items' }).toArray()).toEqual([]);

    const again = await runDeployMigrations(target(v1), {
      action: { kind: 'down', from: CREATE_ITEMS },
      version: 'v1',
    });
    expect(again).toEqual({ applied: [], reverted: [] });
  });

  it('restore sin bucket falla con un mensaje claro', async () => {
    await expect(
      runDeployMigrations(target(v1), {
        action: { kind: 'restore', key: 'latest' },
        version: 'v1',
      }),
    ).rejects.toThrow(/restaurar.*BACKUP_S3/);
  });
});
