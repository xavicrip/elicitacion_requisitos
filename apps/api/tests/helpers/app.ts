import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { runMigrations } from '../../src/db/migrations';
import { MONGO_TEST_URL, REDIS_TEST_URL, uniqueDbName } from './services';

export const TEST_JWT_SECRET = 'secreto-de-prueba-de-al-menos-32-bytes!!';

/**
 * App con MongoDB (base de datos única, ya migrada) y Redis reales, sin montar las rutas de
 * negocio: cada prueba registra los plugins y rutas que necesita antes de `ready()`.
 */
export async function buildTestApp(
  prefix: string,
  options: { featureFlags?: string } = {},
): Promise<{
  app: FastifyInstance;
  dbName: string;
}> {
  const dbName = uniqueDbName(prefix);
  await runMigrations('up', { url: MONGO_TEST_URL, dbName });
  const app = await buildApp({
    logLevel: 'silent',
    services: {
      mongoUrl: MONGO_TEST_URL,
      mongoDb: dbName,
      redisUrl: REDIS_TEST_URL,
      analyticsUrl: 'http://127.0.0.1:9',
      version: 'test',
      commit: 'test',
      // Las pruebas de la 002 necesitan el flag `accounts`; '' deja los valores por defecto.
      featureFlags: options.featureFlags ?? 'accounts=true',
    },
  });
  await app.mongo.asPromise();
  return { app, dbName };
}

/** Cierra la app y elimina su base de datos. */
export async function closeTestApp(app: FastifyInstance): Promise<void> {
  await app.mongo.dropDatabase();
  await app.close();
}
