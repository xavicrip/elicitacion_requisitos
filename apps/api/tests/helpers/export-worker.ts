import { gunzipSync } from 'node:zlib';
import type { ExportInputFile, ExportJobInput } from '@reqcanvas/shared';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { REDIS_TEST_URL } from './services';

/** PDF mínimo que sube el worker falso. */
export const FAKE_PDF = Buffer.from('%PDF-1.7 reporte de prueba');

/** `pdf: null` no sube nada; `summary` sustituye el valor de retorno del job. */
export type ExportReply = { pdf?: Buffer | null; summary?: unknown };
export type ExportHandler = (input: ExportInputFile, data: ExportJobInput) => Promise<ExportReply>;

const succeed: ExportHandler = async () => ({});

/**
 * Worker falso en Node que consume la cola `export` como `analytics-worker` (sin WeasyPrint):
 * descarga la entrada por la URL firmada, sube el PDF por la otra y devuelve el resumen.
 */
export function startFakeExportWorker(queuePrefix: string, handler: ExportHandler = succeed) {
  const connection = new Redis(REDIS_TEST_URL, { maxRetriesPerRequest: null });
  const received: Array<{ data: ExportJobInput; input: ExportInputFile }> = [];
  const worker = new Worker<ExportJobInput>(
    'export',
    async (job) => {
      const download = await fetch(job.data.inputUrl);
      if (!download.ok) throw new Error(`Descarga fallida: ${download.status}`);
      const input = JSON.parse(
        gunzipSync(Buffer.from(await download.arrayBuffer())).toString('utf8'),
      ) as ExportInputFile;
      received.push({ data: job.data, input });
      const reply = await handler(input, job.data);
      const pdf = reply.pdf === undefined ? FAKE_PDF : reply.pdf;
      if (pdf) {
        const upload = await fetch(job.data.outputUrl, {
          method: 'PUT',
          body: new Uint8Array(pdf),
          headers: { 'content-type': 'application/pdf' },
        });
        if (!upload.ok) throw new Error(`Subida fallida: ${upload.status}`);
      }
      return reply.summary ?? { v: 1, status: 'done', bytes: (pdf ?? FAKE_PDF).length, pages: 3 };
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

/** Latido de un worker vivo (`export:worker:{id}`), como el que escribe el de Python. */
export async function writeExportHeartbeat(keyPrefix: string, id = 'fake') {
  const redis = new Redis(REDIS_TEST_URL);
  await redis.set(`${keyPrefix}export:worker:${id}`, '{}', 'EX', 30);
  await redis.quit();
}

export async function clearExportHeartbeat(keyPrefix: string, id = 'fake') {
  const redis = new Redis(REDIS_TEST_URL);
  await redis.del(`${keyPrefix}export:worker:${id}`);
  await redis.quit();
}
