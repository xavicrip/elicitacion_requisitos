import type {
  Detail as DetailDto,
  DetailFields,
  DetailPatch,
  HistoryEntry,
  DetailStatus,
  DetailType,
  Facets,
  Priority,
} from '@reqcanvas/shared';
import { normalizeTag } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { HttpError } from '../../lib/errors.js';
import { activitiesModel } from '../diagrams/models/activity.js';
import type { Diagram } from '../diagrams/models/diagram.js';
import type { Member, Project } from '../projects/model.js';
import { projectsModel } from '../projects/model.js';
import { toDetailDto } from './dto.js';
import { commentsModel } from './models/comment.js';
import { detailsModel, type Detail } from './models/detail.js';
import { historyModel, type DetailHistory, type HistoryChange } from './models/history.js';
import { votesModel } from './models/vote.js';
import { userNames, userRef } from './names.js';
import { detailPermissions } from './permissions.js';

export type Viewer = { project: Project; membership: Member };

export type ListQuery = {
  status?: DetailStatus;
  type?: DetailType;
  priority?: Priority;
  tag?: string;
  sort?: 'votes' | 'recent';
};

const activityNotFound = () =>
  new HttpError(404, 'NOT_FOUND', 'La actividad no está en la versión publicada del diagrama.');

const forbidden = () => new HttpError(403, 'FORBIDDEN', 'No puedes modificar este requisito.');

/** Otra persona guardó antes: la respuesta es el detalle actual (contrato, 409). */
export class DetailConflict extends Error {
  constructor(readonly current: DetailDto) {
    super('rev desactualizado');
  }
}

/** Campos editables que se copian al historial antes de cada cambio (research R3). */
const SNAPSHOT_FIELDS = [
  'given',
  'when',
  'then',
  'type',
  'priority',
  'authorRole',
  'tags',
  'status',
  'duplicateOf',
  'discardReason',
] as const;

function snapshotOf(detail: Detail): Record<string, unknown> {
  return Object.fromEntries(
    SNAPSHOT_FIELDS.map((field) => {
      const value = detail[field];
      return [field, value instanceof Types.ObjectId ? value.toHexString() : (value ?? null)];
    }),
  );
}

export function detailsService(app: FastifyInstance) {
  const Details = detailsModel(app.mongo);
  const Votes = votesModel(app.mongo);
  const Comments = commentsModel(app.mongo);
  const History = historyModel(app.mongo);
  const Activities = activitiesModel(app.mongo);
  const Projects = projectsModel(app.mongo);

  /** Detalles listos para un miembro concreto: autor, si ya votó y sus permisos. */
  async function present(details: Detail[], viewer: Viewer): Promise<DetailDto[]> {
    if (details.length === 0) return [];
    const names = await userNames(
      app,
      details.map((d) => d.authorId),
    );
    const voted = new Set(
      (
        await Votes.find(
          { userId: viewer.membership.userId, detailId: { $in: details.map((d) => d._id) } },
          { detailId: 1 },
        ).lean<Array<{ detailId: Types.ObjectId }>>()
      ).map((vote) => vote.detailId.toHexString()),
    );
    return details.map((detail) =>
      toDetailDto(detail, {
        author: userRef(names, detail.authorId),
        votedByMe: voted.has(detail._id.toHexString()),
        permissions: detailPermissions(detail, viewer.membership, viewer.project),
      }),
    );
  }

  /** Votos propios más los de sus duplicados (research R6). */
  async function effectiveVotes(details: Detail[]): Promise<Map<string, number>> {
    const votes = new Map(details.map((d) => [d._id.toHexString(), d.voteCount]));
    const duplicates = await Details.aggregate<{ _id: Types.ObjectId; votes: number }>([
      { $match: { status: 'duplicate', duplicateOf: { $in: details.map((d) => d._id) } } },
      { $group: { _id: '$duplicateOf', votes: { $sum: '$voteCount' } } },
    ]);
    for (const { _id, votes: extra } of duplicates) {
      const id = _id.toHexString();
      votes.set(id, (votes.get(id) ?? 0) + extra);
    }
    return votes;
  }

  const touchProject = (projectId: Types.ObjectId) =>
    Projects.updateOne({ _id: projectId }, { $set: { lastActivityAt: new Date() } });

  const eventBase = (detail: Detail, viewer: Viewer) => ({
    projectId: detail.projectId.toHexString(),
    diagramId: detail.diagramId.toHexString(),
    actorId: viewer.membership.userId.toHexString(),
    at: new Date().toISOString(),
  });

  async function presentOne(detail: Detail, viewer: Viewer): Promise<DetailDto> {
    const [presented] = await present([detail], viewer);
    return presented!;
  }

  /** Guarda en el historial la versión anterior de un detalle (FR-006). */
  const recordHistory = (before: Detail, change: HistoryChange, viewer: Viewer) =>
    History.create({
      detailId: before._id,
      projectId: before.projectId,
      rev: before.rev,
      snapshot: snapshotOf(before),
      change,
      editedBy: viewer.membership.userId,
    });

  return {
    present,
    loadDetail: (id: string) => Details.findById(id).lean<Detail>(),

    /**
     * Edita solo si `rev` coincide con el guardado (FR-007); si no, `DetailConflict` con el
     * detalle actual. Antes del cambio, la versión anterior va al historial (FR-006).
     */
    async update(current: Detail, rev: number, patch: DetailPatch, viewer: Viewer) {
      if (!detailPermissions(current, viewer.membership, viewer.project).canEdit) throw forbidden();
      const before = await Details.findOneAndUpdate(
        { _id: current._id, rev },
        { $set: patch, $inc: { rev: 1 } },
        { new: false, runValidators: true },
      ).lean<Detail>();
      if (!before) {
        const latest = await Details.findById(current._id).lean<Detail>();
        if (!latest) throw new HttpError(404, 'NOT_FOUND', 'Recurso no encontrado');
        throw new DetailConflict(await presentOne(latest, viewer));
      }
      await recordHistory(before, 'edit', viewer);
      const updated = await presentOne(
        (await Details.findById(current._id).lean<Detail>())!,
        viewer,
      );
      await touchProject(current.projectId);
      await app.detailEvents.emit('detail.updated', {
        ...eventBase(current, viewer),
        detail: updated,
        rev: updated.rev,
      });
      return updated;
    },

    /** Elimina el detalle con sus votos, comentarios e historial (edge case de la spec). */
    async remove(detail: Detail, viewer: Viewer) {
      if (!detailPermissions(detail, viewer.membership, viewer.project).canDelete) {
        throw forbidden();
      }
      await Promise.all([
        Votes.deleteMany({ detailId: detail._id }),
        Comments.deleteMany({ detailId: detail._id }),
        History.deleteMany({ detailId: detail._id }),
      ]);
      await Details.deleteOne({ _id: detail._id });
      await touchProject(detail.projectId);
      await app.detailEvents.emit('detail.deleted', {
        ...eventBase(detail, viewer),
        detailId: detail._id.toHexString(),
        activityKey: detail.activityKey,
      });
    },

    /** Versiones anteriores, de la más reciente a la más antigua. */
    async history(detail: Detail): Promise<HistoryEntry[]> {
      const entries = await History.find({ detailId: detail._id })
        .sort({ rev: -1, editedAt: -1 })
        .lean<DetailHistory[]>();
      const names = await userNames(
        app,
        entries.map((entry) => entry.editedBy),
      );
      return entries.map((entry) => ({
        rev: entry.rev,
        change: entry.change,
        editedBy: userRef(names, entry.editedBy),
        editedAt: entry.editedAt.toISOString(),
        snapshot: entry.snapshot,
      }));
    },

    /**
     * Detalles de una actividad (FR-001, FR-012): por votos efectivos y luego por fecha, o solo
     * por fecha. Un Participante solo ve diagramas con versión publicada.
     */
    async list(diagram: Diagram, activityKey: string, query: ListQuery, viewer: Viewer) {
      if (viewer.membership.role !== 'admin' && !diagram.publishedVersionId) {
        throw new HttpError(404, 'NOT_FOUND', 'Recurso no encontrado');
      }
      const details = await Details.find({
        diagramId: diagram._id,
        activityKey,
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
        ...(query.tag ? { tags: normalizeTag(query.tag) } : {}),
      }).lean<Detail[]>();
      const byDate = (a: Detail, b: Detail) => b.createdAt.getTime() - a.createdAt.getTime();
      if (query.sort === 'recent') {
        details.sort(byDate);
      } else {
        const votes = await effectiveVotes(details);
        details.sort(
          (a, b) =>
            votes.get(b._id.toHexString())! - votes.get(a._id.toHexString())! || byDate(a, b),
        );
      }
      return present(details, viewer);
    },

    /** Alta (constitución I): la actividad debe estar en la versión publicada del diagrama. */
    async create(diagram: Diagram, activityKey: string, input: DetailFields, viewer: Viewer) {
      if (
        !diagram.publishedVersionId ||
        !(await Activities.exists({ versionId: diagram.publishedVersionId, key: activityKey }))
      ) {
        throw activityNotFound();
      }
      const created = await Details.create({
        ...input,
        projectId: diagram.projectId,
        diagramId: diagram._id,
        activityKey,
        authorId: viewer.membership.userId,
      });
      const detail = await presentOne(created.toObject(), viewer);
      await touchProject(diagram.projectId);
      await app.detailEvents.emit('detail.created', {
        ...eventBase(created.toObject(), viewer),
        detail,
      });
      return detail;
    },

    /** Roles y etiquetas usados en el proyecto, por frecuencia (FR-003, research R9). */
    async facets(projectId: Types.ObjectId): Promise<Facets> {
      const count = (field: string, unwind: boolean) =>
        Details.aggregate<{ _id: string; count: number }>([
          { $match: { projectId, [field]: { $nin: [null, ''] } } },
          ...(unwind ? [{ $unwind: `$${field}` }] : []),
          { $group: { _id: `$${field}`, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 50 },
        ]);
      const [roles, tags] = await Promise.all([count('authorRole', false), count('tags', true)]);
      const facet = ({ _id, count }: { _id: string; count: number }) => ({ value: _id, count });
      return { roles: roles.map(facet), tags: tags.map(facet) };
    },
  };
}
