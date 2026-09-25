import type { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { genReqId, observability, REDACT_PATHS } from './plugins/observability.js';

export type BuildAppOptions = {
  logLevel?: string;
  /** Destino de los logs (por defecto stdout); las pruebas lo usan para inspeccionarlos. */
  logStream?: Writable;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: options.logLevel ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[redactado]' },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    requestIdHeader: false,
    requestIdLogLabel: 'reqId',
    genReqId,
  });

  await app.register(observability);
  return app;
}
