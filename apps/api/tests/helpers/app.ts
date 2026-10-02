import type { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import {
  buildApp,
  type AuthConfig,
  type DeletionConfig,
  type DetectionConfig,
  type RealtimeConfig,
} from '../../src/app';
import { runMigrations } from '../../src/db/migrations';
import {
  MONGO_TEST_URL,
  REDIS_TEST_URL,
  S3_TEST_BUCKET,
  S3_TEST_CREDENTIALS,
  S3_TEST_URL,
  uniqueDbName,
} from './services';

export const TEST_JWT_SECRET = 'secreto-de-prueba-de-al-menos-32-bytes!!';

type TestAppOptions = {
  /** `FEATURE_FLAGS`; sin definir, los valores por defecto. */
  featureFlags?: string;
  /**
   * Monta la autenticación completa como en producción (plugins y rutas de la 002). Sin ella,
   * cada prueba registra los plugins y rutas que necesita antes de `ready()`.
   */
  withAuth?: boolean | Partial<AuthConfig>;
  /** Reintentos del job de borrado (por defecto, rápidos para las pruebas). */
  deletion?: DeletionConfig;
  /** Tiempos de la colaboración en tiempo real (feature 005), cortos en las pruebas. */
  realtime?: RealtimeConfig;
  /** Tiempos de la detección (feature 006), cortos en las pruebas. */
  detection?: DetectionConfig;
  /** Reutiliza la base de datos de otra app: dos instancias de `api` (réplicas, feature 005). */
  dbName?: string;
  logStream?: Writable;
};

/** App con MongoDB (base de datos única, ya migrada) y Redis reales. */
export async function buildTestApp(
  prefix: string,
  options: TestAppOptions = {},
): Promise<{ app: FastifyInstance; dbName: string }> {
  const dbName = options.dbName ?? uniqueDbName(prefix);
  await runMigrations('up', { url: MONGO_TEST_URL, dbName });
  const auth: AuthConfig | undefined = options.withAuth
    ? {
        jwtSecret: TEST_JWT_SECRET,
        accessTtl: '15m',
        refreshTtlDays: 7,
        secureCookies: true,
        appBaseUrl: 'https://web.example.com',
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
      featureFlags: options.featureFlags,
      auth,
      realtime: options.realtime,
      detection: options.detection,
      deletion: {
        attempts: 3,
        backoffMs: 10,
        // Colas propias: los jobs no se mezclan entre pruebas.
        queuePrefix: `bull-test-${dbName}`,
        ...options.deletion,
      },
      // Bucket compartido: las claves llevan el projectId, único en cada prueba.
      storage: {
        endpoint: S3_TEST_URL,
        bucket: S3_TEST_BUCKET,
        region: 'us-east-1',
        forcePathStyle: true,
        createBucket: true,
        ...S3_TEST_CREDENTIALS,
      },
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
