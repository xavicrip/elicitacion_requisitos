import type {
  Detail as DetailDto,
  DetailFields,
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
import { usersModel } from '../users/model.js';
import { toDetailDto } from './dto.js';
import { detailsModel, type Detail } from './models/detail.js';
import { votesModel } from './models/vote.js';
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

/** Nombre de usuario que se muestra si la cuenta ya no existe. */
const UNKNOWN_USER = 'Usuario eliminado';

export function detailsService(app: FastifyInstance) {
  const Details = detailsModel(app.mongo);
  const Votes = votesModel(app.mongo);
  const Activities = activitiesModel(app.mongo);
  const Projects = projectsModel(app.mongo);
  const Users = usersModel(app.mongo);

  /** Detalles listos para un miembro concreto: autor, si ya votó y sus permisos. */
  async function present(details: Detail[], viewer: Viewer): Promise<DetailDto[]> {
    if (details.length === 0) return [];
    const authorIds = [...new Set(details.map((d) => d.authorId.toHexString()))];
    const users = await Users.find({ _id: { $in: authorIds } }, { name: 1 }).lean<
      Array<{ _id: Types.ObjectId; name: string }>
    >();
    const names = new Map(users.map((user) => [user._id.toHexString(), user.name]));
    const voted = new Set(
      (
        await Votes.find(
          { userId: viewer.membership.userId, detailId: { $in: details.map((d) => d._id) } },
          { detailId: 1 },
        ).lean<Array<{ detailId: Types.ObjectId }>>()
      ).map((vote) => vote.detailId.toHexString()),
    );
    return details.map((detail) => {
      const authorId = detail.authorId.toHexString();
      return toDetailDto(detail, {
        author: { id: authorId, name: names.get(authorId) ?? UNKNOWN_USER },
        votedByMe: voted.has(detail._id.toHexString()),
        permissions: detailPermissions(detail, viewer.membership, viewer.project),
      });
    });
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

  return {
    present,

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
      const [detail] = await present([created.toObject()], viewer);
      await touchProject(diagram.projectId);
      await app.detailEvents.emit('detail.created', {
        projectId: diagram.projectId.toHexString(),
        diagramId: diagram._id.toHexString(),
        actorId: viewer.membership.userId.toHexString(),
        at: new Date().toISOString(),
        detail: detail!,
      });
      return detail!;
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
