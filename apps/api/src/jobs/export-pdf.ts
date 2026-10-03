import { gzipSync } from 'node:zlib';
import {
  EXPORT_CONTRACT_VERSION,
  ExportInputFileSchema,
  ExportJobReturnSchema,
  type ExportInputFile,
  type ExportJobInput,
} from '@reqcanvas/shared';
import { Queue, QueueEvents } from 'bullmq';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { Types } from 'mongoose';
import { currentRequestId } from '../lib/request-context.js';
import { exportsModel, type ExportDoc } from '../modules/exports/models/export.js';
import { EXPORT_TTL_MS } from '../modules/exports/service.js';
import { exportFileKey } from './export-files.js';

export type ExportPdfConfig = {
  /** Prefijo de las colas (el mismo que el worker: `bull`); las pruebas usan uno propio. */
  queuePrefix?: string;
  /** Prefijo de las claves de Redis (latido del worker). */
  keyPrefix?: string;
  /** Tiempo durante el que se puede descargar el archivo (24 h). */
  ttlMs?: number;
  /** Tiempo máximo de un reporte antes de darlo por fallido (300 s + margen). */
  pdfTimeoutMs?: number;
  /** Cada cuánto se buscan reportes caducados. */
  pdfSweepIntervalMs?: number;
};

declare module 'fastify' {
  interface FastifyInstance {
    /** Cola `export` (feature 008): el reporte PDF lo genera `analytics-worker`. */
    exportPdf: {
      /** Validez de las URLs firmadas del job (y de las imágenes de la entrada). */
      presignTtlSeconds: number;
      /** Sube la entrada al bucket y encola el reporte. */
      enqueue(exported: ExportDoc, input: ExportInputFile): Promise<void>;
      /** Workers con latido reciente en la cola `export` (check `export-worker`). */
      workers(): Promise<number>;
      /** Solo pruebas: busca ya los reportes caducados. */
      sweep(): Promise<string[]>;
    };
  }
}

const QUEUE = 'export';

/** Mensajes al Administrador por código del worker (constitución VI: sin detalles internos). */
const FAILURE_MESSAGES: Record<string, string> = {
  INPUT_DOWNLOAD_FAILED: 'No se pudieron leer los datos del reporte. Vuelve a intentarlo.',
  OUTPUT_UPLOAD_FAILED: 'No se pudo guardar el reporte. Vuelve a intentarlo.',
  TIMEOUT: 'El reporte tardó demasiado en generarse. Vuelve a intentarlo más tarde.',
  EXPORT_FAILED: 'No se pudo generar el reporte. Vuelve a intentarlo.',
};

const inputPrefix = (exported: Pick<ExportDoc, '_id' | 'projectId'>) =>
  `projects/${exported.projectId.toHexString()}/exports/${exported._id.toHexString()}/`;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Cola del reporte PDF entre `api` y `analytics-worker` (contracts/export-job.md), con el patrón
 * del análisis de la 007: la entrada y el PDF viajan por el bucket con URLs firmadas y
 * `QueueEvents` trae el resumen, que se procesa de forma idempotente porque todas las réplicas
 * de `api` reciben los mismos eventos.
 */
export const exportPdfPlugin = fp<ExportPdfConfig & { redisUrl: string }>(
  async (
    app,
    {
      redisUrl,
      queuePrefix = 'bull',
      keyPrefix = '',
      ttlMs = EXPORT_TTL_MS,
      pdfTimeoutMs = 330_000,
      pdfSweepIntervalMs = 30_000,
    },
  ) => {
    const Exports = exportsModel(app.mongo);
    // Las URLs deben seguir valiendo al final de un reporte que espera en la cola.
    const presignTtlSeconds = Math.ceil(pdfTimeoutMs / 1000) + 600;
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    connection.on('error', () => {}); // El plugin `redis` ya avisa si Redis no responde.
    const queue = new Queue<ExportJobInput>(QUEUE, { connection, prefix: queuePrefix });
    const events = new QueueEvents(QUEUE, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
      prefix: queuePrefix,
    });
    events.on('error', () => {});

    const active = { status: { $in: ['pending', 'running'] }, format: 'pdf' } as const;

    async function fail(exportId: string, code: string) {
      const known = code in FAILURE_MESSAGES ? code : 'EXPORT_FAILED';
      const failed = await Exports.findOneAndUpdate(
        { _id: exportId, ...active },
        {
          $set: {
            status: 'failed',
            finishedAt: new Date(),
            error: { code: known, message: FAILURE_MESSAGES[known]! },
          },
        },
        { returnDocument: 'after' },
      ).lean<ExportDoc>();
      if (!failed) return;
      app.log.warn({ exportId, code: known }, 'Reporte fallido');
      await app.storage.deletePrefix(inputPrefix(failed));
    }

    async function complete(exportId: string, returnvalue: unknown) {
      const raw = typeof returnvalue === 'string' ? safeJson(returnvalue) : returnvalue;
      const summary = ExportJobReturnSchema.safeParse(raw);
      if (!summary.success) return fail(exportId, 'EXPORT_FAILED');
      if (summary.data.status === 'failed') return fail(exportId, summary.data.error.code);
      const exported = await Exports.findOne({ _id: exportId, ...active }).lean<ExportDoc>();
      if (!exported) return;
      const finishedAt = new Date();
      const done = await Exports.findOneAndUpdate(
        { _id: exportId, ...active },
        {
          $set: {
            status: 'done',
            fileKey: exportFileKey(exported),
            bytes: summary.data.bytes,
            finishedAt,
            expiresAt: new Date(finishedAt.getTime() + ttlMs),
          },
        },
        { returnDocument: 'after' },
      ).lean<ExportDoc>();
      if (!done) return;
      app.log.info(
        {
          exportId,
          projectId: done.projectId.toHexString(),
          format: 'pdf',
          durationMs: finishedAt.getTime() - done.createdAt.getTime(),
          bytes: summary.data.bytes,
          pages: summary.data.pages,
        },
        'Exportación generada',
      );
      await app.storage.deletePrefix(inputPrefix(done));
    }

    const handle = (what: string, run: () => Promise<unknown>) => {
      run().catch((error: Error) =>
        app.log.error(
          { err: { name: error.name, message: error.message }, what },
          'Evento de exportación',
        ),
      );
    };
    events.on('active', ({ jobId }) =>
      handle('active', () =>
        Exports.updateOne(
          { _id: jobId, status: 'pending', format: 'pdf' },
          { $set: { status: 'running' } },
        ),
      ),
    );
    events.on('completed', ({ jobId, returnvalue }) =>
      handle('completed', () => complete(jobId, returnvalue)),
    );
    events.on('failed', ({ jobId }) => handle('failed', () => fail(jobId, 'EXPORT_FAILED')));

    /** Reportes sin terminar más allá del tiempo máximo (sin worker, o caído a mitad). */
    const sweep = async () => {
      const stale = await Exports.find(
        { ...active, createdAt: { $lt: new Date(Date.now() - pdfTimeoutMs) } },
        { _id: 1 },
      ).lean<Array<{ _id: Types.ObjectId }>>();
      const ids = stale.map(({ _id }) => _id.toHexString());
      for (const id of ids) {
        await fail(id, 'TIMEOUT');
        // Sin worker, el job seguiría en la cola: se retira para que no se procese tarde.
        await queue.remove(id).catch(() => undefined);
      }
      return ids;
    };
    const timer = setInterval(() => handle('sweep', sweep), pdfSweepIntervalMs);
    timer.unref();

    app.decorate('exportPdf', {
      presignTtlSeconds,
      async enqueue(exported, input) {
        const exportId = exported._id.toHexString();
        try {
          const inputKey = `${inputPrefix(exported)}input.json.gz`;
          await app.storage.put(
            inputKey,
            gzipSync(JSON.stringify(ExportInputFileSchema.parse(input))),
            'application/gzip',
          );
          const data: ExportJobInput = {
            v: EXPORT_CONTRACT_VERSION,
            exportId,
            projectId: exported.projectId.toHexString(),
            inputUrl: await app.storage.presignGet(inputKey, presignTtlSeconds),
            outputUrl: await app.storage.presignPut(
              exportFileKey(exported),
              'application/pdf',
              presignTtlSeconds,
            ),
            requestId: currentRequestId() ?? exportId,
          };
          await queue.add('export', data, {
            jobId: exportId,
            attempts: 1,
            removeOnComplete: 1000,
            removeOnFail: 1000,
          });
        } catch (error) {
          await fail(exportId, 'EXPORT_FAILED');
          throw error;
        }
      },
      async workers() {
        let count = 0;
        let cursor = '0';
        do {
          const [next, keys] = await app.redis.scan(
            cursor,
            'MATCH',
            `${keyPrefix}export:worker:*`,
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
  { name: 'export-pdf', dependencies: ['mongo', 'redis'] },
);
