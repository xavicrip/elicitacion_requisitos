import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MigrateMongoConfig } from 'migrate-mongo';

/**
 * Directorio `migrations/` del paquete `api`. Se busca hacia arriba desde este archivo porque
 * la profundidad cambia entre el código fuente (`src/db/`) y el bundle (`dist/`).
 */
function findMigrationsDir(start: string): string {
  for (let dir = start; dir !== dirname(dir); dir = dirname(dir)) {
    const candidate = join(dir, 'migrations');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('No se encontró el directorio migrations/');
}

export const MIGRATIONS_DIR = findMigrationsDir(dirname(fileURLToPath(import.meta.url)));

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
