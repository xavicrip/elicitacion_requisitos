import { overallStatus, type Health, type HealthCheck } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { internalFetch } from '../lib/http-client.js';
import { TimeoutError, withTimeout } from '../lib/timeout.js';
import { pingMongo } from '../plugins/mongo.js';

export type HealthRoutesOptions = {
  analyticsUrl: string;
  version: string;
  commit: string;
  checkTimeoutMs: number;
  flags: Record<string, boolean>;
};

async function runCheck(fn: () => Promise<void>, timeoutMs: number): Promise<HealthCheck> {
  const started = performance.now();
  try {
    await withTimeout(fn(), timeoutMs);
    return { status: 'up', latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - started),
      // Solo el tipo de error: los mensajes pueden incluir hosts internos.
      error: error instanceof TimeoutError ? 'timeout' : (error as Error).name || 'error',
    };
  }
}

/**
 * GET /health (healthcheck de despliegue: Mongo y Redis), GET /health/deep (añade analytics,
 * que solo es accesible por la red privada), GET /version y GET /config.
 */
export async function healthRoutes(app: FastifyInstance, options: HealthRoutesOptions) {
  const { analyticsUrl, version, commit, checkTimeoutMs, flags } = options;

  const directChecks = async () => {
    const [mongo, redis] = await Promise.all([
      runCheck(() => pingMongo(app.mongo), checkTimeoutMs),
      runCheck(async () => void (await app.redis.ping()), checkTimeoutMs),
    ]);
    return { mongo, redis };
  };

  const analyticsCheck = () =>
    runCheck(async () => {
      const response = await internalFetch(`${analyticsUrl}/health`, { timeoutMs: checkTimeoutMs });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }, checkTimeoutMs);

  const respond = (checks: Record<string, HealthCheck>): Health => ({
    status: overallStatus(checks),
    service: 'api',
    version,
    commit,
    checks,
    timestamp: new Date().toISOString(),
  });

  app.get('/health', async (_request, reply) => {
    const body = respond(await directChecks());
    return reply.code(body.status === 'ok' ? 200 : 503).send(body);
  });

  app.get('/health/deep', async (_request, reply) => {
    const [direct, analytics] = await Promise.all([directChecks(), analyticsCheck()]);
    const body = respond({ ...direct, analytics });
    return reply.code(body.status === 'ok' ? 200 : 503).send(body);
  });

  app.get('/version', async () => ({ service: 'api', version, commit }));

  app.get('/config', async () => ({ flags }));
}
