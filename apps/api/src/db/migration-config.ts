import { fileURLToPath } from 'node:url';
import type { MigrateMongoConfig } from 'migrate-mongo';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/**
 * Configuración de migrate-mongo. El lock propio de migrate-mongo 14 queda desactivado
 * (`lockTtl: 0`): lanza `createIndex` sin esperar y deja promesas colgando al cerrar el
 * cliente. En su lugar, `migrations.ts` usa un lock propio.
 */
export function migrationConfig(url: string, dbName: string): MigrateMongoConfig {
  return {
    mongodb: { url, databaseName: dbName },
    migrationsDir: MIGRATIONS_DIR,
    changelogCollectionName: 'changelog',
    lockTtl: 0,
    migrationFileExtension: '.js',
    moduleSystem: 'esm',
  };
}
