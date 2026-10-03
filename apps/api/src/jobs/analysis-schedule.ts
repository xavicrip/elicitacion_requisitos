import { DashboardFiltersSchema } from '@reqcanvas/shared';
import { Queue, Worker } from 'bullmq';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { Types } from 'mongoose';
import { HttpError } from '../lib/errors.js';
import { analysisService } from '../modules/dashboard/analysis.service.js';
import {
  analysisRunsModel,
  type AnalysisRunDoc,
} from '../modules/dashboard/models/analysis-run.js';
import { analysisSettingsModel } from '../modules/dashboard/models/analysis-settings.js';
import { projectsModel, type Project } from '../modules/projects/model.js';

export type Schedule = { enabled: boolean; cron: string; timezone: string };

declare module 'fastify' {
  interface FastifyInstance {
    /** Análisis programados por proyecto (FR-013; plan de la 007, ajuste 9). */
    analysisSchedule: {
      /** Crea, actualiza o quita el programador del proyecto según sus ajustes y su estado. */
      sync(projectId: Types.ObjectId): Promise<void>;
      /** Lo que hace el programador al dispararse; devuelve el run creado o `null`. */
      fire(projectId: string): Promise<AnalysisRunDoc | null>;
      /** Programadores activos (pruebas y diagnóstico). */
      list(): Promise<Array<{ projectId: string; pattern?: string; tz?: string }>>;
    };
  }
}

const QUEUE = 'analysis-schedule';

/**
 * Programación de los análisis (FR-013): un *job scheduler* de BullMQ por proyecto abierto que
 * la tenga activada. Al dispararse solo lanza un análisis si los datos cambiaron desde el último
 * (misma huella que el aviso de desactualizado), así no se repite trabajo ni coste.
 */
export const analysisSchedulePlugin = fp<{ redisUrl: string; queuePrefix?: string }>(
  async (app, { redisUrl, queuePrefix = 'bull' }) => {
    const analysis = analysisService(app);
    const Settings = analysisSettingsModel(app.mongo);
    const Runs = analysisRunsModel(app.mongo);
    const Projects = projectsModel(app.mongo);
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    connection.on('error', () => {});
    const queue = new Queue<{ projectId: string }>(QUEUE, { connection, prefix: queuePrefix });

    async function fire(projectId: string): Promise<AnalysisRunDoc | null> {
      const id = new Types.ObjectId(projectId);
      const project = await Projects.findById(id, { status: 1 }).lean<Pick<Project, 'status'>>();
      if (project?.status !== 'open') return null;
      const filters = DashboardFiltersSchema.parse({});
      const current = await analysis.fingerprint(id, filters);
      if (current.count === 0) return null;
      const last = await Runs.findOne({ projectId: id, status: 'done', kind: 'full' })
        .sort({ createdAt: -1 })
        .lean<AnalysisRunDoc>();
      const unchanged =
        last &&
        last.dataFingerprint.count === current.count &&
        (last.dataFingerprint.maxUpdatedAt?.getTime() ?? 0) ===
          (current.maxUpdatedAt?.getTime() ?? 0);
      if (unchanged) return null;
      try {
        return await analysis.create(id, { filters, trigger: 'scheduled', requestedBy: null });
      } catch (error) {
        // Ya hay uno en curso (lanzado a mano): no hace falta otro.
        if (error instanceof HttpError && error.code === 'ANALYSIS_IN_PROGRESS') return null;
        throw error;
      }
    }

    async function sync(projectId: Types.ObjectId) {
      const key = projectId.toHexString();
      const [settings, project] = await Promise.all([
        Settings.findOne({ projectId }, { schedule: 1 }).lean<{ schedule?: Schedule }>(),
        Projects.findById(projectId, { status: 1 }).lean<Pick<Project, 'status'>>(),
      ]);
      const schedule = settings?.schedule;
      if (schedule?.enabled && project?.status === 'open') {
        await queue.upsertJobScheduler(
          key,
          { pattern: schedule.cron, tz: schedule.timezone },
          {
            name: 'scheduled-analysis',
            data: { projectId: key },
            opts: { removeOnComplete: 50, removeOnFail: 50 },
          },
        );
      } else {
        await queue.removeJobScheduler(key);
      }
    }

    const worker = new Worker<{ projectId: string }>(
      QUEUE,
      async (job) => {
        const run = await fire(job.data.projectId);
        app.log.info(
          { projectId: job.data.projectId, runId: run?._id.toHexString() ?? null },
          run ? 'Análisis programado lanzado' : 'Análisis programado: sin cambios',
        );
      },
      { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }), prefix: queuePrefix },
    );
    worker.on('error', () => {});

    const onProject = ({ projectId }: { projectId: string }) =>
      sync(new Types.ObjectId(projectId)).catch((error: Error) =>
        app.log.error(
          { err: { name: error.name, message: error.message } },
          'Programación del análisis',
        ),
      );
    app.domainEvents.on('project.status_changed', onProject);
    app.domainEvents.on('project.deleted', onProject);

    app.decorate('analysisSchedule', {
      sync,
      fire,
      async list() {
        const schedulers = await queue.getJobSchedulers();
        return schedulers.map((scheduler) => ({
          projectId: scheduler.key,
          pattern: scheduler.pattern ?? undefined,
          tz: scheduler.tz ?? undefined,
        }));
      },
    });

    // Al arrancar se reconcilian los programadores con los ajustes guardados (p. ej. si Redis se
    // vació): los de proyectos con la programación activada.
    app.addHook('onReady', async () => {
      const enabled = await Settings.find({ 'schedule.enabled': true }, { projectId: 1 }).lean<
        Array<{ projectId: Types.ObjectId }>
      >();
      for (const { projectId } of enabled) await sync(projectId);
    });

    app.addHook('onClose', async () => {
      await worker.close();
      await queue.close();
      await connection.quit().catch(() => undefined);
    });
  },
  { name: 'analysis-schedule', dependencies: ['analysis', 'domain-events'] },
);
