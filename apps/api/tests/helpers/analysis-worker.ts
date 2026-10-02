import { readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import type {
  AnalysisInputFile,
  AnalysisJobInput,
  AnalysisJobReturn,
  AnalysisResults,
} from '@reqcanvas/shared';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { REDIS_TEST_URL } from './services';

const example = <T>(name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../analytics/tests/contract/examples/analysis/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as T;

/** Resultados de ejemplo del contrato (los mismos que valida el lado Python). */
export const EXAMPLE_RESULTS = example<AnalysisResults>('results');

export type AnalysisReply = { results?: unknown; summary?: Partial<AnalysisJobReturn> };
export type AnalysisHandler = (
  input: AnalysisInputFile,
  data: AnalysisJobInput,
  job: Job<AnalysisJobInput>,
) => Promise<AnalysisReply>;

const succeed: AnalysisHandler = async (input) => ({
  results: EXAMPLE_RESULTS,
  summary: { detailCount: input.details.length },
});

/**
 * Worker falso en Node que consume la cola `analysis` como `analysis-worker` (sin modelos):
 * descarga la entrada por la URL firmada, sube los resultados por la otra y devuelve el resumen.
 */
export function startFakeAnalysisWorker(queuePrefix: string, handler: AnalysisHandler = succeed) {
  const connection = new Redis(REDIS_TEST_URL, { maxRetriesPerRequest: null });
  const received: Array<{ data: AnalysisJobInput; input: AnalysisInputFile }> = [];
  const worker = new Worker<AnalysisJobInput>(
    'analysis',
    async (job) => {
      const download = await fetch(job.data.inputUrl);
      const input = JSON.parse(
        gunzipSync(Buffer.from(await download.arrayBuffer())).toString('utf8'),
      ) as AnalysisInputFile;
      received.push({ data: job.data, input });
      const reply = await handler(input, job.data, job);
      if (reply.results !== undefined) {
        const upload = await fetch(job.data.resultsUrl, {
          method: 'PUT',
          body: gzipSync(JSON.stringify(reply.results)),
          headers: { 'content-type': 'application/gzip' },
        });
        if (!upload.ok) throw new Error(`Subida fallida: ${upload.status}`);
      }
      return {
        v: 1,
        status: 'done',
        partial: false,
        detailCount: input.details.length,
        stages: EXAMPLE_RESULTS.stages,
        ...reply.summary,
      };
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

/** Latido de un worker vivo (`analysis:worker:{id}`), como el que escribe el de Python. */
export async function writeAnalysisHeartbeat(keyPrefix: string, id = 'fake') {
  const redis = new Redis(REDIS_TEST_URL);
  await redis.set(`${keyPrefix}analysis:worker:${id}`, '{}', 'EX', 30);
  await redis.quit();
}
