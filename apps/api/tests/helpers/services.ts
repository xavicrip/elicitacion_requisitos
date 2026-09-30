import { randomUUID } from 'node:crypto';

/** MongoDB y Redis de prueba: en CI, services del job; en local, contenedores Docker. */
export const MONGO_TEST_URL = process.env.MONGO_TEST_URL ?? 'mongodb://localhost:27017';
export const REDIS_TEST_URL = process.env.REDIS_TEST_URL ?? 'redis://localhost:6379';
/** Servidor S3 de prueba (RustFS): respaldos e imágenes; credenciales por defecto de RustFS. */
export const S3_TEST_URL = process.env.S3_TEST_URL ?? 'http://localhost:9000';
/** Bucket de las imágenes de diagramas en las pruebas (lo crea la app: `createBucket`). */
export const S3_TEST_BUCKET = 'reqcanvas-test';
export const S3_TEST_CREDENTIALS = { accessKeyId: 'rustfsadmin', secretAccessKey: 'rustfsadmin' };

/** Nombre de base de datos único por ejecución para aislar las pruebas. */
export function uniqueDbName(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
