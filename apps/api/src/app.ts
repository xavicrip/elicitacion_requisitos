import type { Writable } from 'node:stream';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadFlags } from './lib/flags.js';
import { mongoPlugin } from './plugins/mongo.js';
import { genReqId, observability, REDACT_PATHS } from './plugins/observability.js';
import { redisPlugin } from './plugins/redis.js';
import { healthRoutes } from './routes/health.js';

export type ServicesConfig = {
  mongoUrl: string;
  mongoDb: string;
  redisUrl: string;
  analyticsUrl: string;
  version: string;
  commit: string;
  featureFlags: string | undefined;
  /** Timeout de cada check de salud (2 s por defecto). */
  checkTimeoutMs?: number;
};

export type BuildAppOptions = {
  logLevel?: string;
  /** Destino de los logs (por defecto stdout); las pruebas lo usan para inspeccionarlos. */
  logStream?: Writable;
  /** Orígenes permitidos por CORS (`CORS_ORIGINS`); vacío = ningún origen cruzado. */
  corsOrigins?: string[];
  /** Dependencias externas. Sin ellas solo se montan los plugins transversales. */
  services?: ServicesConfig;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: options.logLevel ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[redactado]' },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    requestIdHeader: false,
    genReqId,
  });

  await app.register(observability);
  await app.register(helmet);
  await app.register(cors, { origin: options.corsOrigins ?? [], credentials: true });

  const services = options.services;
  if (services) {
    const checkTimeoutMs = services.checkTimeoutMs ?? 2000;
    await app.register(mongoPlugin, {
      url: services.mongoUrl,
      dbName: services.mongoDb,
      timeoutMs: checkTimeoutMs,
    });
    await app.register(redisPlugin, { url: services.redisUrl, timeoutMs: checkTimeoutMs });
    await app.register(healthRoutes, {
      analyticsUrl: services.analyticsUrl,
      version: services.version,
      commit: services.commit,
      checkTimeoutMs,
      flags: loadFlags(services.featureFlags, (message) => app.log.warn(message)),
    });
  }

  return app;
}
