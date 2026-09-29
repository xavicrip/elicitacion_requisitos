import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as migrateMongo from 'migrate-mongo';
import type { MigrationStatus } from 'migrate-mongo';
import type { Db } from 'mongodb';
import { backupKey, dumpDatabase, restoreDatabase, type BackupStore } from './backup.js';
import { MIGRATIONS_DIR, migrationConfig } from './migration-config.js';

/** Base de datos destino; `migrationsDir` solo se cambia en las pruebas. */
type Target = { url: string; dbName: string; migrationsDir?: string };

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
  migrateMongo.config.set(migrationConfig(target.url, target.dbName, target.migrationsDir));
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

/**
 * Acción de migraciones del despliegue, fijada con la variable `MIGRATION_ACTION` del servicio
 * api (docs/runbooks/rollback.md):
 * - `up` (o vacía): aplica las pendientes; si alguna es destructiva, respalda antes la base.
 * - `down:<archivo>`: revierte, de la más reciente hacia atrás, las migraciones aplicadas
 *   desde `<archivo>` inclusive. Si ya no queda ninguna aplicada, no hace nada.
 * - `restore:<clave>|latest`: restaura ese respaldo del bucket (una sola vez) y aplica `up`.
 */
export type MigrationAction =
  { kind: 'up' } | { kind: 'down'; from: string } | { kind: 'restore'; key: string };

const MIGRATION_FILE = /^\d{14}-[\w-]+\.js$/;

export function parseMigrationAction(raw: string | undefined): MigrationAction {
  const value = (raw ?? '').trim();
  if (value === '' || value === 'up') return { kind: 'up' };
  const separator = value.indexOf(':');
  const kind = separator === -1 ? value : value.slice(0, separator);
  const argument = separator === -1 ? '' : value.slice(separator + 1);
  if (kind === 'down' && MIGRATION_FILE.test(argument)) return { kind: 'down', from: argument };
  if (kind === 'restore' && argument !== '') return { kind: 'restore', key: argument };
  throw new Error(
    `MIGRATION_ACTION inválida: "${value}". Usa up, down:<archivo de migración> o restore:<clave>|latest`,
  );
}

export type DeployResult = {
  applied: string[];
  reverted: string[];
  backup?: string;
  restored?: string;
};

type DeployOptions = {
  action: MigrationAction;
  /** Bucket de respaldos; sin él, falla si hace falta respaldar o restaurar. */
  store?: BackupStore;
  /** Versión que se despliega; forma parte de la clave del respaldo. */
  version: string;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

const RESTORES_COLLECTION = 'ops_restores';

async function isDestructive(dir: string, fileName: string): Promise<boolean> {
  const migration = (await import(pathToFileURL(join(dir, fileName)).href)) as {
    destructive?: unknown;
  };
  return migration.destructive === true;
}

function requireStore(store: BackupStore | undefined, reason: string): BackupStore {
  if (!store) {
    throw new Error(`${reason}, pero el bucket de respaldos no está configurado (BACKUP_S3_*)`);
  }
  return store;
}

/** preDeployCommand de api (`migrate auto`): ejecuta la acción bajo el lock de migraciones. */
export function runDeployMigrations(target: Target, options: DeployOptions): Promise<DeployResult> {
  const { action, store, version, log = () => {} } = options;
  return withDatabase(target, ({ db, client }) =>
    withLock(db, async () => {
      const result: DeployResult = { applied: [], reverted: [] };

      if (action.kind === 'down') {
        for (;;) {
          const applied = (await migrateMongo.status(db)).filter((m) => m.appliedAt !== 'PENDING');
          const last = applied.at(-1);
          if (!last || last.fileName < action.from) break;
          result.reverted.push(...(await migrateMongo.down(db, client)));
        }
        if (result.reverted.length === 0) log('Nada que revertir', { from: action.from });
        return result;
      }

      if (action.kind === 'restore') {
        const backups = requireStore(store, 'Se pidió restaurar un respaldo');
        const key = action.key === 'latest' ? await backups.latestKey() : action.key;
        if (!key) throw new Error('No hay respaldos en el bucket');
        const restores = db.collection<{ _id: string; restoredAt: Date }>(RESTORES_COLLECTION);
        // Si la variable se queda fijada, un redespliegue posterior no vuelve a restaurar.
        if (await restores.findOne({ _id: key })) {
          log('Respaldo ya restaurado; se omite', { key });
        } else {
          const collections = await restoreDatabase(db, await backups.get(key));
          await restores.insertOne({ _id: key, restoredAt: new Date() });
          log('Respaldo restaurado', { key, collections });
          result.restored = key;
        }
      }

      const pending = (await migrateMongo.status(db)).filter((m) => m.appliedAt === 'PENDING');
      const destructive: string[] = [];
      for (const { fileName } of pending) {
        if (await isDestructive(target.migrationsDir ?? MIGRATIONS_DIR, fileName)) {
          destructive.push(fileName);
        }
      }
      if (destructive.length > 0) {
        const backups = requireStore(
          store,
          `Hay migraciones destructivas pendientes (${destructive.join(', ')})`,
        );
        const key = backupKey(version);
        await backups.put(key, await dumpDatabase(db));
        log('Respaldo guardado antes de las migraciones destructivas', { key, destructive });
        result.backup = key;
      }
      result.applied = await migrateMongo.up(db, client);
      return result;
    }),
  );
}
