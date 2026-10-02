import { readFileSync } from 'node:fs';
import type { DetectionJobInput, DetectionResult } from '@reqcanvas/shared';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { REDIS_TEST_URL } from './services';

/** Resultado de ejemplo del contrato (el mismo que valida el lado Python). */
export const EXAMPLE_RESULT = JSON.parse(
  readFileSync(
    new URL('../../../analytics/tests/contract/examples/result.json', import.meta.url),
    'utf8',
  ),
) as DetectionResult;

export type FakeHandler = (
  data: DetectionJobInput,
  job: Job<DetectionJobInput>,
) => Promise<DetectionResult>;

/**
 * Worker falso en Node que consume la cola `detection` como `analytics-worker` (plan de la 006,
 * ajuste 12): las pruebas de `api` no dependen de OpenCV ni de Tesseract.
 */
export function startFakeWorker(queuePrefix: string, handler: FakeHandler) {
  const connection = new Redis(REDIS_TEST_URL, { maxRetriesPerRequest: null });
  const received: DetectionJobInput[] = [];
  const worker = new Worker<DetectionJobInput>(
    'detection',
    async (job) => {
      received.push(job.data);
      return handler(job.data, job);
    },
    { connection, prefix: queuePrefix },
  );
  worker.on('error', () => {});
  return {
    received,
    async close() {
      await worker.close();
      await connection.quit().catch(() => undefined);
    },
  };
}

/** Latido de un worker vivo (`detection:worker:{id}`), como el que escribe el de Python. */
export async function writeHeartbeat(keyPrefix: string, id = 'fake') {
  const redis = new Redis(REDIS_TEST_URL);
  await redis.set(`${keyPrefix}detection:worker:${id}`, '{}', 'EX', 30);
  await redis.quit();
}
