import { Queue, Worker, type Job } from 'bullmq';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { Types } from 'mongoose';
import type { DeletionConfig } from '../app.js';
import { invitationsModel } from '../modules/invitations/model.js';
import { createCascadeRegistry, type CascadeHandler } from '../modules/projects/cascade.js';
import { projectsModel } from '../modules/projects/model.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Registra un manejador de borrado en cascada (features 003–008). */
    registerProjectCascade(name: string, handler: CascadeHandler): void;
    /** Encola el borrado de un proyecto ya marcado como `deleting`. */
    enqueueProjectDeletion(projectId: string): Promise<void>;
  }
}

const QUEUE = 'project-deletion';
type JobData = { projectId: string };

/**
 * Borrado en cascada asíncrono (research R9): el proyecto se marca `deleting` (404 para todos)
 * y un worker BullMQ, dentro de api, ejecuta los manejadores registrados. El estado del trabajo
 * queda en `projects.deletion` (constitución VI). Al terminar se conserva una "lápida" sin datos
 * del proyecto, para que `deletion.status: done` siga siendo consultable.
 */
export const projectDeletionPlugin = fp<DeletionConfig & { redisUrl: string }>(
  async (app, { redisUrl, attempts = 5, backoffMs = 5000, queuePrefix = 'bull' }) => {
    const Projects = projectsModel(app.mongo);
    const cascade = createCascadeRegistry();
    // Lo que pertenece a la propia feature 002; las demás features registran lo suyo.
    cascade.register('invitations', async (projectId) => {
      await invitationsModel(app.mongo).deleteMany({ projectId });
    });

    // BullMQ necesita su propia conexión, sin límite de reintentos por comando.
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    connection.on('error', () => {}); // El plugin `redis` ya avisa si Redis no responde.
    const queue = new Queue<JobData>(QUEUE, { connection, prefix: queuePrefix });

    const worker = new Worker<JobData>(
      QUEUE,
      async (job: Job<JobData>) => {
        const _id = new Types.ObjectId(job.data.projectId);
        const attempt = job.attemptsStarted;
        await Projects.updateOne(
          { _id },
          { $set: { 'deletion.status': 'running', 'deletion.attempts': attempt } },
        );
        await cascade.run(_id);
        await Projects.updateOne(
          { _id },
          {
            $set: {
              name: '',
              description: '',
              members: [],
              'deletion.status': 'done',
              'deletion.attempts': attempt,
            },
            $unset: { 'deletion.error': '' },
          },
        );
        app.log.info({ projectId: job.data.projectId, attempt }, 'Proyecto eliminado');
      },
      { connection, prefix: queuePrefix },
    );

    worker.on('failed', (job, error) => {
      if (!job) return;
      const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
      app.log[exhausted ? 'error' : 'warn'](
        { projectId: job.data.projectId, attempt: job.attemptsMade, err: { name: error.name } },
        exhausted ? 'El borrado del proyecto falló definitivamente' : 'Reintentando el borrado',
      );
      if (exhausted) {
        void Projects.updateOne(
          { _id: new Types.ObjectId(job.data.projectId) },
          {
            $set: {
              'deletion.status': 'failed',
              'deletion.attempts': job.attemptsMade,
              'deletion.error': error.message.slice(0, 200),
            },
          },
        ).catch(() => undefined);
      }
    });
    worker.on('error', () => {});

    app.decorate('registerProjectCascade', (name: string, handler: CascadeHandler) =>
      cascade.register(name, handler),
    );
    app.decorate('enqueueProjectDeletion', async (projectId: string) => {
      await queue.add(
        'delete',
        { projectId },
        {
          // Un solo job por proyecto aunque se pida dos veces.
          jobId: `delete-${projectId}`,
          attempts,
          backoff: { type: 'exponential', delay: backoffMs },
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
    });

    app.addHook('onClose', async () => {
      await worker.close();
      await queue.close();
      await connection.quit().catch(() => undefined);
    });
  },
  { name: 'project-deletion', dependencies: ['mongo'] },
);
