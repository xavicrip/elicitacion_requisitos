import {
  ANALYSIS_CONTRACT_VERSION,
  ANALYSIS_STAGES,
  AnalysisProgressSchema,
  type AnalysisJobInput,
} from '@reqcanvas/shared';
import { Queue, QueueEvents } from 'bullmq';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { currentRequestId } from '../lib/request-context.js';
import { analysisService, type AnalysisEnqueue } from '../modules/dashboard/analysis.service.js';

export type AnalysisConfig = {
  /** Prefijo de las colas (el mismo que el worker: `bull`); las pruebas usan uno propio. */
  queuePrefix?: string;
  /** Prefijo de las claves de Redis (latido del worker). */
  keyPrefix?: string;
  /** Tiempo máximo de un análisis antes de darlo por fallido (900 s + margen). */
  timeoutMs?: number;
  /** Cada cuánto se buscan análisis caducados. */
  sweepIntervalMs?: number;
};

declare module 'fastify' {
  interface FastifyInstance {
    /** Cola `analysis` (feature 007): encolar y saber si hay algún worker vivo. */
    analysis: {
      enqueue: AnalysisEnqueue;
      /** Workers con latido reciente (check `analysis-worker` de `/health/deep`). */
      workers(): Promise<number>;
      /** Solo pruebas: busca ya los análisis caducados. */
      sweep(): Promise<string[]>;
    };
  }
}

const QUEUE = 'analysis';

/**
 * Cola del análisis entre `api` y `analysis-worker` (contracts/analysis-job.md), con el patrón
 * de la detección (plan de la 007, ajuste 2). La entrada y los resultados viajan por el bucket
 * con URLs firmadas; `QueueEvents` trae el progreso y el resumen, que el servicio procesa de forma
 * idempotente porque todas las réplicas de `api` reciben los mismos eventos.
 */
export const analysisPlugin = fp<AnalysisConfig & { redisUrl: string }>(
  async (
    app,
    {
      redisUrl,
      queuePrefix = 'bull',
      keyPrefix = '',
      timeoutMs = 960_000,
      sweepIntervalMs = 60_000,
    },
  ) => {
    const service = analysisService(app);
    // Las URLs deben seguir valiendo al final de un análisis que espera en la cola.
    const presignTtlSeconds = Math.ceil(timeoutMs / 1000) + 600;
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    connection.on('error', () => {}); // El plugin `redis` ya avisa si Redis no responde.
    const queue = new Queue<AnalysisJobInput>(QUEUE, { connection, prefix: queuePrefix });
    const events = new QueueEvents(QUEUE, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
      prefix: queuePrefix,
    });
    events.on('error', () => {});

    const handle = (what: string, run: () => Promise<unknown>) => {
      run().catch((error: Error) =>
        app.log.error(
          { err: { name: error.name, message: error.message }, what },
          'Evento de análisis',
        ),
      );
    };
    events.on('active', ({ jobId }) => handle('active', () => service.markRunning(jobId)));
    events.on('progress', ({ jobId, data }) => {
      const progress = AnalysisProgressSchema.safeParse(data);
      if (progress.success) handle('progress', () => service.progress(jobId, progress.data));
    });
    events.on('completed', ({ jobId, returnvalue }) =>
      handle('completed', () => service.complete(jobId, returnvalue)),
    );
    events.on('failed', ({ jobId }) => handle('failed', () => service.fail(jobId, 'INTERNAL')));

    const sweep = async () => {
      const expired = await service.expire(timeoutMs);
      // Sin worker, el job seguiría en la cola: se retira para que no se procese tarde.
      for (const jobId of expired) await queue.remove(jobId).catch(() => undefined);
      return expired;
    };
    const timer = setInterval(() => handle('sweep', sweep), sweepIntervalMs);
    timer.unref();

    app.decorate('analysis', {
      async enqueue(run, { previousResultsKey, insightsEnabled }) {
        const settings = await service.settingsFor(run.projectId);
        const data: AnalysisJobInput = {
          v: ANALYSIS_CONTRACT_VERSION,
          runId: run._id.toHexString(),
          projectId: run.projectId.toHexString(),
          kind: run.kind,
          inputUrl: await app.storage.presignGet(run.inputKey, presignTtlSeconds),
          resultsUrl: await app.storage.presignPut(
            run.resultsKey,
            'application/gzip',
            presignTtlSeconds,
          ),
          previousResultsUrl: previousResultsKey
            ? await app.storage.presignGet(previousResultsKey, presignTtlSeconds)
            : null,
          stages: run.kind === 'insights' ? ['insights'] : [...ANALYSIS_STAGES],
          settings: { ...settings, insightsEnabled },
          requestId: currentRequestId() ?? run._id.toHexString(),
        };
        await queue.add('analyze', data, {
          jobId: data.runId,
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        });
      },
      async workers() {
        let count = 0;
        let cursor = '0';
        do {
          const [next, keys] = await app.redis.scan(
            cursor,
            'MATCH',
            `${keyPrefix}analysis:worker:*`,
            'COUNT',
            100,
          );
          count += keys.length;
          cursor = next;
        } while (cursor !== '0');
        return count;
      },
      sweep,
    });

    app.addHook('onClose', async () => {
      clearInterval(timer);
      await events.close();
      await queue.close();
      await connection.quit().catch(() => undefined);
    });
  },
  { name: 'analysis', dependencies: ['mongo', 'redis'] },
);
