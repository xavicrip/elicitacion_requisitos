import type { ActivityInput, ActivityPatch, Activity as ActivityDto } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { HttpError } from '../../lib/errors.js';
import { auditService } from '../audit/service.js';
import { projectsModel } from '../projects/model.js';
import { toActivityDto } from './dto.js';
import { activitiesModel, type Activity } from './models/activity.js';
import { versionsModel, type DiagramVersion } from './models/version.js';

/** `ETag` de una actividad: su `rev` (concurrencia optimista, research R6). */
export const activityEtag = (rev: number) => `"${rev}"`;

/** Lee el `rev` de `If-Match` (`"3"`, `W/"3"` o `3`); 428 si falta o no es válido. */
export function parseIfMatch(header: string | undefined): number {
  const rev = header
    ?.trim()
    .replace(/^W\//, '')
    .replace(/^"(.*)"$/, '$1');
  if (!rev || !/^\d+$/.test(rev)) {
    throw new HttpError(
      428,
      'PRECONDITION_REQUIRED',
      'Falta la versión de la actividad (If-Match). Recarga la página e inténtalo de nuevo.',
    );
  }
  return Number(rev);
}

/** Otro administrador guardó antes: la respuesta es la actividad actual (contrato, 409). */
export class RevConflict extends Error {
  constructor(readonly current: Activity) {
    super('rev desactualizado');
  }
}

const notDraft = () =>
  new HttpError(
    409,
    'VERSION_NOT_DRAFT',
    'Esta versión ya está publicada: sube una versión nueva para cambiar sus actividades.',
  );

type Actor = { actorId: string };

export function activitiesService(app: FastifyInstance) {
  const Activities = activitiesModel(app.mongo);
  const Versions = versionsModel(app.mongo);
  const Projects = projectsModel(app.mongo);
  const audit = auditService(app.mongo, app.log);

  async function draftOf(versionId: Types.ObjectId): Promise<DiagramVersion> {
    const version = await Versions.findById(versionId).lean<DiagramVersion>();
    if (!version || version.status !== 'draft') throw notDraft();
    return version;
  }

  /** Las transiciones solo apuntan a otras actividades de la misma versión (FR-005). */
  async function checkNext(versionId: Types.ObjectId, next: string[], selfKey?: string) {
    const invalid = () =>
      new HttpError(
        400,
        'INVALID_TRANSITION',
        'Las transiciones solo pueden ir a otras actividades de este diagrama.',
        {},
        { next: 'Transición no válida.' },
      );
    if (selfKey && next.includes(selfKey)) throw invalid();
    if (next.length === 0) return;
    const found = await Activities.countDocuments({ versionId, key: { $in: next } });
    if (found !== next.length) throw invalid();
  }

  async function record(action: string, activity: Activity, actorId: string, diff: object) {
    await Projects.updateOne({ _id: activity.projectId }, { $set: { lastActivityAt: new Date() } });
    await audit.record(action, {
      actorId: new Types.ObjectId(actorId),
      projectId: activity.projectId,
      entity: { type: 'activity', id: activity._id.toHexString() },
      diff: { versionId: activity.versionId.toHexString(), ...diff },
    });
  }

  return {
    loadActivity: (id: string) => Activities.findById(id).lean<Activity>(),

    async create(version: DiagramVersion, input: ActivityInput, { actorId }: Actor) {
      if (version.status !== 'draft') throw notDraft();
      const next = input.next ?? [];
      await checkNext(version._id, next);
      const created = await Activities.create({
        versionId: version._id,
        diagramId: version.diagramId,
        projectId: version.projectId,
        label: input.label,
        type: input.type,
        bbox: input.bbox,
        next,
      });
      const activity = created.toObject();
      await record('activity.created', activity, actorId, {
        label: activity.label,
        key: activity.key,
      });
      return toActivityDto(activity);
    },

    /** Guarda solo si `rev` coincide con el guardado; si no, `RevConflict` con la actual. */
    async update(
      current: Activity,
      rev: number,
      patch: ActivityPatch,
      { actorId }: Actor,
    ): Promise<ActivityDto> {
      await draftOf(current.versionId);
      if (patch.next) await checkNext(current.versionId, patch.next, current.key);
      const updated = await Activities.findOneAndUpdate(
        { _id: current._id, rev },
        { $set: patch, $inc: { rev: 1 } },
        { new: true, runValidators: true },
      ).lean<Activity>();
      if (!updated) {
        const latest = await Activities.findById(current._id).lean<Activity>();
        if (!latest) throw new HttpError(404, 'NOT_FOUND', 'Recurso no encontrado');
        throw new RevConflict(latest);
      }
      await record('activity.updated', updated, actorId, patch);
      return toActivityDto(updated);
    },

    /**
     * Elimina la actividad y retira su `key` de las transiciones de las demás. Si otros datos
     * dependen de ella (requisitos, 004), exige `confirm` y los elimina primero.
     */
    async remove(activity: Activity, confirm: boolean, { actorId }: Actor) {
      await draftOf(activity.versionId);
      const ref = {
        projectId: activity.projectId,
        versionId: activity.versionId,
        activityId: activity._id,
        key: activity.key,
      };
      const { total } = await app.activityDependents.count(ref);
      if (total > 0 && !confirm) {
        throw new HttpError(
          409,
          'HAS_DEPENDENTS',
          `Esta actividad tiene ${total} elemento(s) asociado(s). Confirma para eliminarlos también.`,
          {},
          undefined,
          { detailCount: total },
        );
      }
      if (total > 0) await app.activityDependents.remove(ref);
      await Activities.deleteOne({ _id: activity._id });
      await Activities.updateMany(
        { versionId: activity.versionId, next: activity.key },
        { $pull: { next: activity.key }, $inc: { rev: 1 } },
      );
      await record('activity.deleted', activity, actorId, {
        label: activity.label,
        dependents: total,
      });
    },
  };
}
