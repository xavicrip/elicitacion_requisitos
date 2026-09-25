import type { Writable } from 'node:stream';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { genReqId, observability, REDACT_PATHS } from './plugins/observability.js';

export type BuildAppOptions = {
  logLevel?: string;
  /** Destino de los logs (por defecto stdout); las pruebas lo usan para inspeccionarlos. */
  logStream?: Writable;
  /** Orígenes permitidos por CORS (`CORS_ORIGINS`); vacío = ningún origen cruzado. */
  corsOrigins?: string[];
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
  return app;
}
