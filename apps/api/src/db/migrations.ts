import * as migrateMongo from 'migrate-mongo';
import type { MigrationStatus } from 'migrate-mongo';
import type { Db } from 'mongodb';
import { migrationConfig } from './migration-config.js';

type Target = { url: string; dbName: string };

const LOCK_COLLECTION = 'changelog_lock';
const LOCK_TTL_SECONDS = 300;

export class MigrationLockedError extends Error {
  constructor() {
    super('Hay otra ejecución de migraciones en curso; reintenta en unos minutos.');
    this.name = 'MigrationLockedError';
  }
}

/** Lock de un solo documento con TTL: evita que dos despliegues migren a la vez. */
async function withLock<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  const locks = db.collection<{ _id: string; createdAt: Date }>(LOCK_COLLECTION);
  await locks.createIndex({ createdAt: 1 }, { expireAfterSeconds: LOCK_TTL_SECONDS });
  try {
    await locks.insertOne({ _id: 'migrations', createdAt: new Date() });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new MigrationLockedError();
    throw error;
  }
  try {
    return await fn();
  } finally {
    await locks.deleteOne({ _id: 'migrations' });
  }
}

async function withDatabase<T>(
  target: Target,
  fn: (connection: Awaited<ReturnType<typeof migrateMongo.database.connect>>) => Promise<T>,
): Promise<T> {
  migrateMongo.config.set(migrationConfig(target.url, target.dbName));
  const connection = await migrateMongo.database.connect();
  try {
    return await fn(connection);
  } finally {
    await connection.client.close();
  }
}

/** Aplica (`up`) todas las migraciones pendientes o revierte (`down`) la última aplicada. */
export function runMigrations(direction: 'up' | 'down', target: Target): Promise<string[]> {
  return withDatabase(target, ({ db, client }) =>
    withLock(db, () => migrateMongo[direction](db, client)),
  );
}

export function migrationsStatus(target: Target): Promise<MigrationStatus[]> {
  return withDatabase(target, ({ db }) => migrateMongo.status(db));
}
