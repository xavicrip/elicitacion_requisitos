import {
  DETECTION_CONTRACT_VERSION,
  DetectionProgressSchema,
  type DetectionJobInput,
} from '@reqcanvas/shared';
import { Queue, QueueEvents } from 'bullmq';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { currentRequestId } from '../lib/request-context.js';
import { detectionService, type DetectionEnqueue } from '../modules/detection/service.js';

export type DetectionConfig = {
  /** Prefijo de las colas (el mismo que el worker: `bull`); las pruebas usan uno propio. */
  queuePrefix?: string;
  /** Prefijo de las claves de Redis (latido del worker). */
  keyPrefix?: string;
  /** Tiempo máximo de una detección antes de darla por fallida (180 s + margen). */
  timeoutMs?: number;
  /** Cada cuánto se buscan detecciones caducadas. */
  sweepIntervalMs?: number;
  /** Validez de la URL firmada de la imagen. */
  presignTtlSeconds?: number;
};

declare module 'fastify' {
  interface FastifyInstance {
    /** Cola `detection` (feature 006): encolar y saber si hay algún worker vivo. */
    detection: {
      enqueue: DetectionEnqueue;
      /** Workers con latido reciente (check `detection-worker` de `/health/deep`). */
      workers(): Promise<number>;
      /** Solo pruebas: busca ya las detecciones caducadas. */
      sweep(): Promise<string[]>;
    };
  }
}

const QUEUE = 'detection';

/**
 * Cola de la detección entre `api` y `analytics-worker` (research R1, contracts/detection-job.md).
 * `QueueEvents` lleva el progreso, el resultado y los fallos de vuelta; el servicio los guarda de
 * forma idempotente, porque todas las réplicas de `api` reciben los mismos eventos.
 */
export const detectionPlugin = fp<DetectionConfig & { redisUrl: string }>(
  async (
    app,
    {
      redisUrl,
      queuePrefix = 'bull',
      keyPrefix = '',
      timeoutMs = 210_000,
      sweepIntervalMs = 30_000,
      presignTtlSeconds = 600,
    },
  ) => {
    const service = detectionService(app);
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    connection.on('error', () => {}); // El plugin `redis` ya avisa si Redis no responde.
    const queue = new Queue<DetectionJobInput>(QUEUE, { connection, prefix: queuePrefix });
    const events = new QueueEvents(QUEUE, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
      prefix: queuePrefix,
    });
    events.on('error', () => {});

    const handle = (what: string, run: () => Promise<unknown>) => {
      run().catch((error: Error) =>
        app.log.error(
          { err: { name: error.name, message: error.message }, what },
          'Evento de detección',
        ),
      );
    };
    events.on('active', ({ jobId }) => handle('active', () => service.markRunning(jobId)));
    events.on('progress', ({ jobId, data }) => {
      const progress = DetectionProgressSchema.safeParse(data);
      if (progress.success) handle('progress', () => service.progress(jobId, progress.data));
    });
    events.on('completed', ({ jobId, returnvalue }) =>
      handle('completed', () => service.complete(jobId, returnvalue)),
    );
    events.on('failed', ({ jobId, failedReason }) =>
      handle('failed', () => service.fail(jobId, failedReason)),
    );

    const sweep = async () => {
      const expired = await service.expire(timeoutMs);
      // Sin worker, el job seguiría en la cola: se retira para que no se procese tarde.
      for (const jobId of expired) await queue.remove(jobId).catch(() => undefined);
      return expired;
    };
    const timer = setInterval(() => handle('sweep', sweep), sweepIntervalMs);
    timer.unref();

    app.decorate('detection', {
      async enqueue(job, version) {
        const url = await app.storage.presignGet(version.image.displayKey, presignTtlSeconds);
        const data: DetectionJobInput = {
          v: DETECTION_CONTRACT_VERSION,
          jobId: job._id.toHexString(),
          versionId: job.versionId.toHexString(),
          image: { url, width: version.image.width, height: version.image.height },
          options: job.options,
          requestId: currentRequestId() ?? job._id.toHexString(),
        };
        await queue.add('detect', data, {
          jobId: data.jobId,
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
            `${keyPrefix}detection:worker:*`,
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
  { name: 'detection', dependencies: ['mongo', 'redis', 'domain-events'] },
);
