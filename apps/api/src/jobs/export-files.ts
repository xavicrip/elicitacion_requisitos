import { Queue, Worker } from 'bullmq';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { Types } from 'mongoose';
import { exportsModel, type ExportDoc } from '../modules/exports/models/export.js';
import { exportQuery } from '../modules/exports/query.js';
import { CONTENT_TYPE, EXTENSION, isFileFormat, renderExport } from '../modules/exports/render.js';
import { EXPORT_TTL_MS } from '../modules/exports/service.js';

export type ExportFilesConfig = {
  queuePrefix?: string;
  /** Tiempo durante el que se puede descargar el archivo (24 h). */
  ttlMs?: number;
  /** Cada cuánto se borran los archivos caducados (1 h). */
  sweepEveryMs?: number;
};

declare module 'fastify' {
  interface FastifyInstance {
    /** Exportaciones en segundo plano que genera `api` (plan de la 008, ajuste 4). */
    exportFiles: {
      enqueue(exported: ExportDoc): Promise<void>;
      /** Borra del bucket los archivos caducados y vacía su `fileKey`; devuelve cuántos. */
      sweep(now?: Date): Promise<number>;
      /** Marca la exportación como terminada con su archivo ya en el bucket. */
      finish(id: Types.ObjectId, fileKey: string, bytes: number): Promise<void>;
    };
  }
}

const QUEUE = 'export-files';
const SWEEP = 'sweep';

type JobData = { exportId: string };

async function toBuffer(stream: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Clave del archivo de una exportación, bajo el prefijo del proyecto (cascada de la 003). */
export const exportFileKey = (exported: Pick<ExportDoc, '_id' | 'projectId' | 'format'>) =>
  `projects/${exported.projectId.toHexString()}/exports/${exported._id.toHexString()}.${EXTENSION[exported.format]}`;

/**
 * Cola `export-files`: CSV, Excel y Gherkin de más de 1 000 detalles se generan en un `Worker`
 * de BullMQ dentro de `api` y se suben al bucket. El mismo plugin borra cada hora los archivos
 * caducados (FR-006 y FR-007).
 */
export const exportFilesPlugin = fp<{ redisUrl: string } & ExportFilesConfig>(
  async (
    app,
    { redisUrl, queuePrefix = 'bull', ttlMs = EXPORT_TTL_MS, sweepEveryMs = 60 * 60 * 1000 },
  ) => {
    const Exports = exportsModel(app.mongo);
    const query = exportQuery(app);
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    connection.on('error', () => {});
    const queue = new Queue<JobData>(QUEUE, { connection, prefix: queuePrefix });

    async function finish(id: Types.ObjectId, fileKey: string, bytes: number) {
      const finishedAt = new Date();
      await Exports.updateOne(
        { _id: id },
        {
          $set: {
            status: 'done',
            fileKey,
            bytes,
            finishedAt,
            expiresAt: new Date(finishedAt.getTime() + ttlMs),
          },
        },
      );
    }

    async function generate(exportId: string) {
      const started = Date.now();
      const exported = await Exports.findOneAndUpdate(
        { _id: new Types.ObjectId(exportId), status: 'pending' },
        { $set: { status: 'running' } },
        { returnDocument: 'after' },
      ).lean<ExportDoc>();
      // Ya procesada o borrada con su proyecto: no hay nada que hacer.
      if (!exported) return;
      const log = {
        exportId,
        projectId: exported.projectId.toHexString(),
        format: exported.format,
      };
      try {
        if (!isFileFormat(exported.format)) throw new Error(`Formato ${exported.format}`);
        const body = await toBuffer(
          renderExport(
            exported.format,
            query.rows(exported.projectId, exported.filters),
            exported.options,
            await query.timeZone(exported.projectId),
          ),
        );
        const fileKey = exportFileKey(exported);
        await app.storage.put(fileKey, body, CONTENT_TYPE[exported.format]);
        await finish(exported._id, fileKey, body.length);
        app.log.info(
          { ...log, durationMs: Date.now() - started, bytes: body.length },
          'Exportación generada',
        );
      } catch (error) {
        await Exports.updateOne(
          { _id: exported._id },
          {
            $set: {
              status: 'failed',
              finishedAt: new Date(),
              error: { code: 'EXPORT_FAILED', message: 'No se pudo generar la exportación.' },
            },
          },
        );
        app.log.error(
          { ...log, durationMs: Date.now() - started, err: { name: (error as Error).name } },
          'Exportación fallida',
        );
      }
    }

    async function sweep(now = new Date()): Promise<number> {
      const expired = await Exports.find(
        { fileKey: { $type: 'string' }, expiresAt: { $lte: now } },
        { fileKey: 1 },
      ).lean<Array<Pick<ExportDoc, '_id' | 'fileKey'>>>();
      for (const exported of expired) {
        await app.storage.deletePrefix(exported.fileKey!);
        await Exports.updateOne({ _id: exported._id }, { $set: { fileKey: null } });
      }
      return expired.length;
    }

    const worker = new Worker<JobData>(
      QUEUE,
      async (job) => {
        if (job.name === SWEEP) {
          const removed = await sweep();
          if (removed) app.log.info({ removed }, 'Exportaciones caducadas borradas');
          return;
        }
        await generate(job.data.exportId);
      },
      { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }), prefix: queuePrefix },
    );
    worker.on('error', () => {});

    app.decorate('exportFiles', {
      async enqueue(exported: ExportDoc) {
        const exportId = exported._id.toHexString();
        await queue.add(
          'export',
          { exportId },
          { jobId: exportId, attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
        );
      },
      sweep,
      finish,
    });

    app.addHook('onReady', async () => {
      await queue.upsertJobScheduler(
        SWEEP,
        { every: sweepEveryMs },
        { name: SWEEP, opts: { removeOnComplete: 10, removeOnFail: 10 } },
      );
    });

    app.addHook('onClose', async () => {
      await worker.close();
      await queue.close();
      await connection.quit().catch(() => undefined);
    });
  },
  { name: 'export-files' },
);
