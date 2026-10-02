import { gunzipSync, gzipSync } from 'node:zlib';
import {
  ANALYSIS_CONTRACT_VERSION,
  ANALYSIS_STAGES,
  AnalysisJobReturnSchema,
  AnalysisResultsSchema,
  type AnalysisInputFile,
  type AnalysisProgress,
  type AnalysisResults,
  type AnalysisRun,
  type AnalysisStage,
  type DashboardFilters,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { HttpError } from '../../lib/errors.js';
import { detailsModel, type Detail } from '../details/models/detail.js';
import { activitiesModel } from '../diagrams/models/activity.js';
import { diagramsModel } from '../diagrams/models/diagram.js';
import { detailsQuery } from './filters.js';
import { analysisRunsModel, type AnalysisRunDoc } from './models/analysis-run.js';
import { analysisSettingsModel, DEFAULT_SCHEDULE } from './models/analysis-settings.js';
import { duplicateDecisionsModel } from './models/duplicate-decision.js';
import { insightFeedbackModel } from './models/insight-feedback.js';

/** Runs que se conservan por proyecto; los anteriores y sus archivos se borran. */
export const KEEP_RUNS = 10;

/** Mensajes al Administrador por código del worker (constitución VI: sin detalles internos). */
const FAILURE_MESSAGES: Record<string, string> = {
  INPUT_DOWNLOAD_FAILED: 'No se pudieron leer los detalles para el análisis. Vuelve a intentarlo.',
  RESULTS_UPLOAD_FAILED: 'No se pudieron guardar los resultados del análisis. Vuelve a intentarlo.',
  TIMEOUT: 'El análisis tardó demasiado. Vuelve a intentarlo más tarde.',
  INTERNAL: 'No se pudo completar el análisis. Vuelve a intentarlo.',
};

export const analysisFailureFor = (code: string) => {
  const known = code in FAILURE_MESSAGES ? code : 'INTERNAL';
  return { code: known, message: FAILURE_MESSAGES[known]! };
};

export type AnalysisEnqueue = (
  run: AnalysisRunDoc,
  options: { previousResultsKey: string | null; insightsEnabled: boolean },
) => Promise<void>;

const prefixOf = (projectId: Types.ObjectId, runId: Types.ObjectId) =>
  `projects/${projectId.toHexString()}/analysis/${runId.toHexString()}/`;

type CreateRun = {
  filters: DashboardFilters;
  trigger: 'manual' | 'scheduled';
  requestedBy: string | null;
};

export function analysisService(app: FastifyInstance) {
  const Runs = analysisRunsModel(app.mongo);
  const Details = detailsModel(app.mongo);
  const Settings = analysisSettingsModel(app.mongo);

  async function timeZoneOf(projectId: Types.ObjectId) {
    const settings = await Settings.findOne({ projectId }).lean<{
      schedule?: { timezone?: string };
    }>();
    return settings?.schedule?.timezone ?? DEFAULT_SCHEDULE.timezone;
  }

  /** Huella de los datos analizados: si cambia, el análisis está desactualizado (FR-014). */
  async function fingerprint(projectId: Types.ObjectId, filters: DashboardFilters) {
    const query = detailsQuery(projectId, filters, await timeZoneOf(projectId));
    const [count, latest] = await Promise.all([
      Details.countDocuments(query),
      Details.findOne(query, { updatedAt: 1 }).sort({ updatedAt: -1 }).lean<{ updatedAt: Date }>(),
    ]);
    return { count, maxUpdatedAt: latest?.updatedAt ?? null };
  }

  /** Conjunto analizado (contracts/analysis-job.md): sin datos del autor (plan, ajuste 1). */
  async function exportInput(
    projectId: Types.ObjectId,
    filters: DashboardFilters,
  ): Promise<AnalysisInputFile> {
    const query = detailsQuery(projectId, filters, await timeZoneOf(projectId));
    const details = await Details.find(query, { authorId: 0 })
      .sort({ createdAt: 1 })
      .lean<Array<Omit<Detail, 'authorId'>>>();
    const diagrams = await diagramsModel(app.mongo)
      .find({ projectId, publishedVersionId: { $ne: null } }, { publishedVersionId: 1 })
      .lean<Array<{ _id: Types.ObjectId; publishedVersionId: Types.ObjectId }>>();
    const activities = await activitiesModel(app.mongo)
      .find(
        { versionId: { $in: diagrams.map((diagram) => diagram.publishedVersionId) } },
        { key: 1, label: 1, versionId: 1 },
      )
      .lean<Array<{ key: string; label: string; versionId: Types.ObjectId }>>();
    const diagramOfVersion = new Map(
      diagrams.map((diagram) => [diagram.publishedVersionId.toHexString(), diagram._id]),
    );
    const decisions = await duplicateDecisionsModel(app.mongo)
      .find({ projectId }, { pair: 1, decision: 1 })
      .lean<Array<{ pair: [string, string]; decision: 'confirmed' | 'rejected' }>>();
    return {
      v: ANALYSIS_CONTRACT_VERSION,
      projectId: projectId.toHexString(),
      filters,
      activities: activities.map((activity) => ({
        key: activity.key,
        diagramId: diagramOfVersion.get(activity.versionId.toHexString())!.toHexString(),
        label: activity.label,
      })),
      details: details.map((detail) => ({
        id: detail._id.toHexString(),
        diagramId: detail.diagramId.toHexString(),
        activityKey: detail.activityKey,
        given: detail.given,
        when: detail.when,
        then: detail.then,
        type: detail.type,
        priority: detail.priority ?? null,
        authorRole: detail.authorRole ?? null,
        tags: detail.tags,
        status: detail.status,
        voteCount: detail.voteCount ?? 0,
        commentCount: detail.commentCount ?? 0,
        createdAt: detail.createdAt.toISOString(),
      })),
      duplicateDecisions: decisions.map(({ pair, decision }) => ({ pair, decision })),
    };
  }

  async function settingsFor(projectId: Types.ObjectId) {
    const settings = await Settings.findOne({ projectId }).lean<{
      extraAmbiguousTerms?: string[];
      extraStopwords?: string[];
    }>();
    const rejected = await insightFeedbackModel(app.mongo)
      .find({ projectId, useful: false }, { statement: 1 })
      .sort({ at: -1 })
      .limit(50)
      .lean<Array<{ statement: string }>>();
    return {
      extraAmbiguousTerms: settings?.extraAmbiguousTerms ?? [],
      extraStopwords: settings?.extraStopwords ?? [],
      rejectedInsights: rejected.map((feedback) => feedback.statement),
    };
  }

  /** Borra los runs más antiguos del proyecto y sus archivos (data-model.md). */
  async function prune(projectId: Types.ObjectId) {
    const old = await Runs.find({ projectId, status: { $in: ['done', 'failed'] } }, { _id: 1 })
      .sort({ createdAt: -1 })
      .skip(KEEP_RUNS)
      .lean<Array<{ _id: Types.ObjectId }>>();
    for (const { _id } of old) {
      await app.storage.deletePrefix(prefixOf(projectId, _id));
      await Runs.deleteOne({ _id });
    }
  }

  async function readResults(key: string): Promise<unknown> {
    const object = await app.storage.getStream(key);
    if (!object) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.from(chunk as Uint8Array));
    try {
      return JSON.parse(gunzipSync(Buffer.concat(chunks)).toString('utf8'));
    } catch {
      return null;
    }
  }

  return {
    exportInput,
    fingerprint,
    settingsFor,

    /**
     * Crea un run `pending`, sube la entrada al bucket y lo encola. Un segundo análisis activo en
     * el proyecto → `409 ANALYSIS_IN_PROGRESS` con el id del que está en curso.
     */
    async create(projectId: Types.ObjectId, input: CreateRun): Promise<AnalysisRunDoc> {
      const _id = new Types.ObjectId();
      const prefix = prefixOf(projectId, _id);
      const data = await exportInput(projectId, input.filters);
      let run: AnalysisRunDoc;
      try {
        run = (
          await Runs.create({
            _id,
            projectId,
            trigger: input.trigger,
            kind: 'full',
            filters: input.filters,
            dataFingerprint: await fingerprint(projectId, input.filters),
            detailCount: data.details.length,
            inputKey: `${prefix}input.json.gz`,
            resultsKey: `${prefix}results.json.gz`,
            requestedBy: input.requestedBy ? new Types.ObjectId(input.requestedBy) : null,
          })
        ).toObject<AnalysisRunDoc>();
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const active = await Runs.findOne(
          { projectId, status: { $in: ['pending', 'running'] } },
          { _id: 1 },
        ).lean<{ _id: Types.ObjectId }>();
        throw new HttpError(
          409,
          'ANALYSIS_IN_PROGRESS',
          'Ya hay un análisis en curso en este proyecto. Espera a que termine.',
          {},
          undefined,
          { runId: active?._id.toHexString() ?? null },
        );
      }
      try {
        await app.storage.put(run.inputKey, gzipSync(JSON.stringify(data)), 'application/gzip');
        await app.analysis.enqueue(run, {
          previousResultsKey: null,
          insightsEnabled: Boolean(app.flags.insights),
        });
      } catch (error) {
        await this.fail(_id.toHexString(), 'INTERNAL');
        throw error;
      }
      return run;
    },

    async markRunning(runId: string) {
      await Runs.updateOne(
        { _id: runId, status: 'pending' },
        { $set: { status: 'running', startedAt: new Date() } },
      );
    },

    async progress(runId: string, progress: AnalysisProgress) {
      await Runs.updateOne(
        { _id: runId, status: { $in: ['pending', 'running'] } },
        { $set: { status: 'running', progress } },
      );
    },

    /**
     * Procesa el retorno del worker: valida los resultados del bucket y cierra el run, solo una
     * vez aunque varias réplicas de `api` reciban el mismo evento.
     */
    async complete(runId: string, returnvalue: unknown) {
      const raw = typeof returnvalue === 'string' ? safeJson(returnvalue) : returnvalue;
      const summary = AnalysisJobReturnSchema.safeParse(raw);
      if (!summary.success) return this.fail(runId, 'INTERNAL');
      if (summary.data.status === 'failed') return this.fail(runId, summary.data.error!.code);
      const run = await Runs.findById(runId).lean<AnalysisRunDoc>();
      if (!run || (run.status !== 'pending' && run.status !== 'running')) return;
      const results = AnalysisResultsSchema.safeParse(await readResults(run.resultsKey));
      if (!results.success) {
        app.log.error({ runId }, 'Resultados del análisis inválidos');
        return this.fail(runId, 'INTERNAL');
      }
      const done = await Runs.findOneAndUpdate(
        { _id: runId, status: { $in: ['pending', 'running'] } },
        {
          $set: {
            status: 'done',
            partial: summary.data.partial,
            stages: summary.data.stages,
            detailCount: summary.data.detailCount,
            progress: null,
            finishedAt: new Date(),
          },
        },
        { returnDocument: 'after' },
      ).lean<AnalysisRunDoc>();
      if (done) await prune(done.projectId);
    },

    async fail(runId: string, code: string) {
      const error = analysisFailureFor(code);
      const run = await Runs.findOneAndUpdate(
        { _id: runId, status: { $in: ['pending', 'running'] } },
        { $set: { status: 'failed', error, progress: null, finishedAt: new Date() } },
        { returnDocument: 'after' },
      ).lean<AnalysisRunDoc>();
      if (!run) return;
      app.log.warn({ runId, code: error.code }, 'Análisis fallido');
      await prune(run.projectId);
    },

    /** Runs sin terminar más allá del tiempo máximo (sin worker, o caído a mitad). */
    async expire(timeoutMs: number): Promise<string[]> {
      const stale = await Runs.find(
        {
          status: { $in: ['pending', 'running'] },
          createdAt: { $lt: new Date(Date.now() - timeoutMs) },
        },
        { _id: 1 },
      ).lean<Array<{ _id: Types.ObjectId }>>();
      for (const { _id } of stale) await this.fail(_id.toHexString(), 'TIMEOUT');
      return stale.map(({ _id }) => _id.toHexString());
    },

    /** Resultados de un run terminado (del bucket), o `null` si no hay. */
    async results(run: AnalysisRunDoc): Promise<AnalysisResults | null> {
      if (run.status !== 'done') return null;
      const parsed = AnalysisResultsSchema.safeParse(await readResults(run.resultsKey));
      return parsed.success ? parsed.data : null;
    },

    /** Run tal como lo ve la web, con la obsolescencia respecto a los datos actuales. */
    async toDto(run: AnalysisRunDoc, results?: AnalysisResults | null): Promise<AnalysisRun> {
      const current = await fingerprint(run.projectId, run.filters);
      const newer = run.dataFingerprint.maxUpdatedAt
        ? await Details.countDocuments({
            ...detailsQuery(run.projectId, run.filters, await timeZoneOf(run.projectId)),
            updatedAt: { $gt: run.dataFingerprint.maxUpdatedAt },
          })
        : current.count;
      const stale =
        current.count !== run.dataFingerprint.count ||
        (current.maxUpdatedAt?.getTime() ?? 0) !==
          (run.dataFingerprint.maxUpdatedAt?.getTime() ?? 0);
      return {
        id: run._id.toHexString(),
        projectId: run.projectId.toHexString(),
        status: run.status,
        partial: run.partial,
        kind: run.kind,
        trigger: run.trigger,
        progress: run.progress ?? null,
        filters: run.filters,
        stages: Object.fromEntries(
          Object.entries(run.stages ?? {}).filter(([stage]) =>
            (ANALYSIS_STAGES as readonly string[]).includes(stage),
          ),
        ) as Partial<Record<AnalysisStage, NonNullable<AnalysisRun['stages'][AnalysisStage]>>>,
        detailCount: run.detailCount,
        stale,
        newDetailsSinceRun: stale
          ? Math.max(newer, current.count - run.dataFingerprint.count, 0)
          : 0,
        error: run.error ?? null,
        createdAt: run.createdAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        ...(results ? { results } : {}),
      };
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export type AnalysisService = ReturnType<typeof analysisService>;
