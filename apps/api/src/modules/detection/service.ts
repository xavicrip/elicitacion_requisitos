import {
  confidenceLevel,
  DetectionResultSchema,
  type ActivityProposal,
  type BBox,
  type DetectionJob,
  type DetectionProgress,
  type DetectionStartInput,
  type ProposalFlag,
  type Proposals,
  type TransitionProposal,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { HttpError } from '../../lib/errors.js';
import { activitiesModel } from '../diagrams/models/activity.js';
import type { DiagramVersion } from '../diagrams/models/version.js';
import { activityProposalsModel, type ActivityProposalDoc } from './models/activity-proposal.js';
import { detectionJobsModel, type DetectionJobDoc } from './models/job.js';
import {
  transitionProposalsModel,
  type TransitionProposalDoc,
} from './models/transition-proposal.js';

/** Solapamiento a partir del cual una propuesta es un posible duplicado (research R7). */
export const DUPLICATE_IOU = 0.5;

/** Mensajes al Administrador por código de error del worker (constitución VI: sin detalles). */
const FAILURE_MESSAGES: Record<string, string> = {
  IMAGE_DOWNLOAD_FAILED: 'No se pudo leer la imagen del diagrama. Vuelve a intentarlo.',
  TIMEOUT: 'La detección tardó demasiado. Vuelve a intentarlo o marca las zonas manualmente.',
  INTERNAL: 'No se pudo completar la detección. Vuelve a intentarlo o marca las zonas manualmente.',
};

export const failureFor = (code: string) => ({
  code: code in FAILURE_MESSAGES ? code : 'INTERNAL',
  message: FAILURE_MESSAGES[code] ?? FAILURE_MESSAGES.INTERNAL!,
});

export function iou(a: BBox, b: BBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

export function toJobDto(job: DetectionJobDoc): DetectionJob {
  return {
    id: job._id.toHexString(),
    versionId: job.versionId.toHexString(),
    status: job.status,
    progress: { stage: job.progress.stage, pct: job.progress.pct },
    error: job.error ? { code: job.error.code, message: job.error.message } : null,
    metrics: { ...job.metrics },
    createdAt: job.createdAt.toISOString(),
    finishedAt: iso(job.finishedAt),
  };
}

export function toActivityProposalDto(proposal: ActivityProposalDoc): ActivityProposal {
  return {
    id: proposal._id.toHexString(),
    jobId: proposal.jobId.toHexString(),
    versionId: proposal.versionId.toHexString(),
    bbox: { x: proposal.bbox.x, y: proposal.bbox.y, w: proposal.bbox.w, h: proposal.bbox.h },
    type: proposal.type,
    label: proposal.label,
    confidence: proposal.confidence,
    confidenceLevel: proposal.confidenceLevel,
    flags: [...proposal.flags],
    status: proposal.status,
    activityId: proposal.activityId?.toHexString() ?? null,
  };
}

export function toTransitionProposalDto(proposal: TransitionProposalDoc): TransitionProposal {
  return {
    id: proposal._id.toHexString(),
    jobId: proposal.jobId.toHexString(),
    versionId: proposal.versionId.toHexString(),
    fromProposalId: proposal.fromProposalId.toHexString(),
    toProposalId: proposal.toProposalId.toHexString(),
    confidence: proposal.confidence,
    status: proposal.status,
  };
}

const isDuplicateKey = (error: unknown) => (error as { code?: number }).code === 11000;

const notDraft = () =>
  new HttpError(409, 'VERSION_NOT_DRAFT', 'Esta versión ya no está en borrador.');

export type DetectionEnqueue = (job: DetectionJobDoc, version: DiagramVersion) => Promise<void>;

/**
 * Detección asistida en `api` (plan de la 006, ajustes 1, 5–7): el job vive en
 * `detection_jobs` (estados de la constitución VI) y las propuestas solo se guardan aquí: el
 * worker devuelve el resultado y nunca escribe en MongoDB (Principio II).
 */
export function detectionService(app: FastifyInstance) {
  const Jobs = detectionJobsModel(app.mongo);
  const ActivityProposals = activityProposalsModel(app.mongo);
  const TransitionProposals = transitionProposalsModel(app.mongo);
  const Activities = activitiesModel(app.mongo);

  const base = (job: DetectionJobDoc) => ({
    projectId: job.projectId.toHexString(),
    diagramId: job.diagramId.toHexString(),
    versionId: job.versionId.toHexString(),
    jobId: job._id.toHexString(),
    at: new Date().toISOString(),
  });

  return {
    async start(
      version: DiagramVersion,
      input: Required<DetectionStartInput>,
      actorId: string,
      enqueue: DetectionEnqueue,
    ): Promise<DetectionJob> {
      if (version.status !== 'draft') throw notDraft();
      let job: DetectionJobDoc;
      try {
        job = (
          await Jobs.create({
            projectId: version.projectId,
            diagramId: version.diagramId,
            versionId: version._id,
            options: {
              // El refinamiento con Claude solo si lo permite el flag operativo (coste).
              llmRefine: input.llmRefine && Boolean(app.flags['detection-llm']),
              arrows: input.arrows,
              languages: ['spa', 'eng'],
            },
            requestedBy: new Types.ObjectId(actorId),
          })
        ).toObject();
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        throw new HttpError(
          409,
          'DETECTION_IN_PROGRESS',
          'Ya hay una detección en curso para esta versión.',
        );
      }
      try {
        await enqueue(job, version);
      } catch (error) {
        await Jobs.updateOne(
          { _id: job._id },
          { $set: { status: 'failed', error: failureFor('INTERNAL'), finishedAt: new Date() } },
        );
        throw error;
      }
      return toJobDto(job);
    },

    async latest(versionId: Types.ObjectId): Promise<DetectionJob> {
      const job = await Jobs.findOne({ versionId }).sort({ createdAt: -1, _id: -1 }).lean();
      if (!job) throw new HttpError(404, 'NOT_FOUND', 'Recurso no encontrado');
      return toJobDto(job as DetectionJobDoc);
    },

    async proposals(versionId: Types.ObjectId): Promise<Proposals> {
      const [activities, transitions] = await Promise.all([
        ActivityProposals.find({ versionId, status: 'pending' })
          .sort({ 'bbox.y': 1, 'bbox.x': 1 })
          .lean<ActivityProposalDoc[]>(),
        TransitionProposals.find({ versionId, status: 'pending' }).lean<TransitionProposalDoc[]>(),
      ]);
      return {
        activities: activities.map(toActivityProposalDto),
        transitions: transitions.map(toTransitionProposalDto),
      };
    },

    /** El worker empezó (`active`): idempotente, también si llega más de una vez. */
    async markRunning(jobId: string) {
      await Jobs.updateOne(
        { _id: jobId, status: 'pending' },
        { $set: { status: 'running', startedAt: new Date() } },
      );
    },

    async progress(jobId: string, progress: DetectionProgress) {
      const job = await Jobs.findOneAndUpdate(
        { _id: jobId, status: { $in: ['pending', 'running'] } },
        { $set: { status: 'running', progress } },
        { new: true },
      ).lean<DetectionJobDoc>();
      if (job) await app.domainEvents.emit('detection.progress', { ...base(job), ...progress });
    },

    /**
     * Guarda el resultado: solo una vez aunque varias réplicas reciban el evento `completed`
     * (la primera que pasa el job a `done` es la que guarda). Las propuestas pendientes de
     * detecciones anteriores pasan a `superseded`; las ya aceptadas no se tocan.
     */
    async complete(jobId: string, returnvalue: unknown) {
      const raw = typeof returnvalue === 'string' ? safeJson(returnvalue) : returnvalue;
      const parsed = DetectionResultSchema.safeParse(raw);
      if (!parsed.success) {
        app.log.error(
          { jobId, issues: parsed.error.issues.slice(0, 3) },
          'Resultado de detección inválido',
        );
        return this.fail(jobId, 'INTERNAL');
      }
      const result = parsed.data;
      const job = await Jobs.findOneAndUpdate(
        { _id: jobId, status: { $in: ['pending', 'running'] } },
        {
          $set: {
            status: 'done',
            progress: { stage: 'refine', pct: 100 },
            finishedAt: new Date(),
            'metrics.proposed': result.activities.length,
            'metrics.durationMs': result.stats.durationMs,
            'metrics.llmUsed': result.stats.llmUsed,
          },
        },
        { new: true },
      ).lean<DetectionJobDoc>();
      if (!job) return;

      await Promise.all([
        ActivityProposals.updateMany(
          { versionId: job.versionId, status: 'pending', jobId: { $ne: job._id } },
          { $set: { status: 'superseded' } },
        ),
        TransitionProposals.updateMany(
          { versionId: job.versionId, status: 'pending', jobId: { $ne: job._id } },
          { $set: { status: 'superseded' } },
        ),
      ]);
      const existing = await Activities.find({ versionId: job.versionId }, { bbox: 1 }).lean<
        Array<{ bbox: BBox }>
      >();
      const ids = new Map<string, Types.ObjectId>();
      const docs = result.activities.map((activity) => {
        const _id = new Types.ObjectId();
        ids.set(activity.tempId, _id);
        const flags: ProposalFlag[] = [...activity.flags];
        if (existing.some(({ bbox }) => iou(bbox, activity.bbox) >= DUPLICATE_IOU)) {
          flags.push('possible_duplicate');
        }
        return {
          _id,
          projectId: job.projectId,
          jobId: job._id,
          versionId: job.versionId,
          tempId: activity.tempId,
          bbox: activity.bbox,
          type: activity.type,
          label: activity.label,
          confidence: activity.confidence,
          confidenceLevel: confidenceLevel(activity.confidence),
          flags: [...new Set(flags)],
        };
      });
      if (docs.length) await ActivityProposals.insertMany(docs);
      const transitions = result.transitions.map((transition) => ({
        projectId: job.projectId,
        jobId: job._id,
        versionId: job.versionId,
        fromProposalId: ids.get(transition.from)!,
        toProposalId: ids.get(transition.to)!,
        confidence: transition.confidence,
      }));
      if (transitions.length) await TransitionProposals.insertMany(transitions);
      app.log.info(
        { jobId, proposed: docs.length, durationMs: result.stats.durationMs },
        'Detección completada',
      );
      await app.domainEvents.emit('detection.completed', { ...base(job), proposed: docs.length });
    },

    async fail(jobId: string, code: string) {
      const error = failureFor(code);
      const job = await Jobs.findOneAndUpdate(
        { _id: jobId, status: { $in: ['pending', 'running'] } },
        { $set: { status: 'failed', error, finishedAt: new Date() } },
        { new: true },
      ).lean<DetectionJobDoc>();
      if (!job) return;
      app.log.warn({ jobId, code: error.code }, 'Detección fallida');
      await app.domainEvents.emit('detection.failed', { ...base(job), error });
    },

    /** Jobs sin terminar más allá del tiempo máximo (sin worker, o caído a mitad). */
    async expire(timeoutMs: number): Promise<string[]> {
      const stale = await Jobs.find(
        {
          status: { $in: ['pending', 'running'] },
          createdAt: { $lt: new Date(Date.now() - timeoutMs) },
        },
        { _id: 1 },
      ).lean<Array<{ _id: Types.ObjectId }>>();
      for (const { _id } of stale) await this.fail(_id.toHexString(), 'TIMEOUT');
      return stale.map(({ _id }) => _id.toHexString());
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

export type DetectionService = ReturnType<typeof detectionService>;
