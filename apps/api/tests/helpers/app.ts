import type { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AuthConfig } from '../../src/app';
import { runMigrations } from '../../src/db/migrations';
import { MONGO_TEST_URL, REDIS_TEST_URL, uniqueDbName } from './services';

export const TEST_JWT_SECRET = 'secreto-de-prueba-de-al-menos-32-bytes!!';

type TestAppOptions = {
  /** `FEATURE_FLAGS`; por defecto `accounts=true`. `''` deja los valores por defecto. */
  featureFlags?: string;
  /**
   * Monta la autenticación completa como en producción (plugins y rutas de la 002). Sin ella,
   * cada prueba registra los plugins y rutas que necesita antes de `ready()`.
   */
  withAuth?: boolean | Partial<AuthConfig>;
  logStream?: Writable;
};

/** App con MongoDB (base de datos única, ya migrada) y Redis reales. */
export async function buildTestApp(
  prefix: string,
  options: TestAppOptions = {},
): Promise<{ app: FastifyInstance; dbName: string }> {
  const dbName = uniqueDbName(prefix);
  await runMigrations('up', { url: MONGO_TEST_URL, dbName });
  const auth: AuthConfig | undefined = options.withAuth
    ? {
        jwtSecret: TEST_JWT_SECRET,
        accessTtl: '15m',
        refreshTtlDays: 7,
        secureCookies: true,
        // Claves de Redis propias: los contadores no se comparten entre pruebas.
        redisNameSpace: `test-${dbName}:`,
        ...(typeof options.withAuth === 'object' ? options.withAuth : {}),
      }
    : undefined;
  const app = await buildApp({
    logLevel: options.logStream ? 'info' : 'silent',
    logStream: options.logStream,
    services: {
      mongoUrl: MONGO_TEST_URL,
      mongoDb: dbName,
      redisUrl: REDIS_TEST_URL,
      analyticsUrl: 'http://127.0.0.1:9',
      version: 'test',
      commit: 'test',
      // Las pruebas de la 002 necesitan el flag `accounts`; '' deja los valores por defecto.
      featureFlags: options.featureFlags ?? 'accounts=true',
      auth,
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
