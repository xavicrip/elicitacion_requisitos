import { randomUUID } from 'node:crypto';

/** MongoDB y Redis de prueba: en CI, services del job; en local, contenedores Docker. */
export const MONGO_TEST_URL = process.env.MONGO_TEST_URL ?? 'mongodb://localhost:27017';
export const REDIS_TEST_URL = process.env.REDIS_TEST_URL ?? 'redis://localhost:6379';

/** Nombre de base de datos único por ejecución para aislar las pruebas. */
export function uniqueDbName(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
