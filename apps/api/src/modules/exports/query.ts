import type { DashboardFilters, DetailStatus, DetailType, Priority } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { detailsQuery } from '../dashboard/filters.js';
import { analysisSettingsModel, DEFAULT_SCHEDULE } from '../dashboard/models/analysis-settings.js';
import { detailsModel, type Detail } from '../details/models/detail.js';
import { activitiesModel } from '../diagrams/models/activity.js';
import { diagramsModel } from '../diagrams/models/diagram.js';
import { usersModel } from '../users/model.js';

/** Una fila de la exportación: el detalle con los nombres ya resueltos. */
export type ExportRow = {
  id: string;
  shortId: string;
  diagramId: string;
  diagramName: string;
  activityKey: string;
  /** `null` si la actividad ya no existe en la versión publicada. */
  activityLabel: string | null;
  given: string;
  when: string;
  then: string;
  type: DetailType;
  priority: Priority | null;
  authorRole: string | null;
  tags: string[];
  status: DetailStatus;
  duplicateOfShortId: string | null;
  discardReason: string | null;
  voteCount: number;
  commentCount: number;
  authorName: string;
  createdAt: Date;
  updatedAt: Date;
};

/** ID corto que se muestra en las exportaciones: los 8 últimos caracteres. */
export const shortId = (id: { toString(): string }) => id.toString().slice(-8);

/**
 * Selección de los detalles a exportar (feature 008), con los filtros del dashboard. Recorre un
 * cursor: nunca carga todos los detalles en memoria. A diferencia del dashboard, los duplicados
 * confirmados se exportan si el filtro de estados los pide.
 */
export function exportQuery(app: FastifyInstance) {
  const Details = detailsModel(app.mongo);

  async function timeZone(projectId: Types.ObjectId): Promise<string> {
    const settings = await analysisSettingsModel(app.mongo)
      .findOne({ projectId })
      .lean<{ schedule?: { timezone?: string } }>();
    return settings?.schedule?.timezone ?? DEFAULT_SCHEDULE.timezone;
  }

  function query(projectId: Types.ObjectId, filters: DashboardFilters, zone: string) {
    return { ...detailsQuery(projectId, filters, zone), status: { $in: filters.statuses } };
  }

  return {
    timeZone,

    async count(projectId: Types.ObjectId, filters: DashboardFilters): Promise<number> {
      return Details.countDocuments(query(projectId, filters, await timeZone(projectId)));
    },

    /** Filas ordenadas por diagrama, actividad y fecha de creación. */
    async *rows(projectId: Types.ObjectId, filters: DashboardFilters): AsyncGenerator<ExportRow> {
      const filter = query(projectId, filters, await timeZone(projectId));
      const diagrams = await diagramsModel(app.mongo)
        .find({ projectId }, { name: 1, publishedVersionId: 1 })
        .lean<
          Array<{ _id: Types.ObjectId; name: string; publishedVersionId: Types.ObjectId | null }>
        >();
      const diagramNames = new Map(
        diagrams.map((diagram) => [diagram._id.toHexString(), diagram.name]),
      );
      const activities = await activitiesModel(app.mongo)
        .find(
          {
            versionId: {
              $in: diagrams.flatMap((diagram) =>
                diagram.publishedVersionId ? [diagram.publishedVersionId] : [],
              ),
            },
          },
          { key: 1, label: 1 },
        )
        .lean<Array<{ key: string; label: string }>>();
      const labels = new Map(activities.map((activity) => [activity.key, activity.label]));
      const authorIds = (await Details.distinct('authorId', filter)) as Types.ObjectId[];
      const authors = await usersModel(app.mongo)
        .find({ _id: { $in: authorIds } }, { name: 1 })
        .lean<Array<{ _id: Types.ObjectId; name: string }>>();
      const names = new Map(authors.map((author) => [author._id.toHexString(), author.name]));

      const cursor = Details.find(filter)
        .sort({ diagramId: 1, activityKey: 1, createdAt: 1, _id: 1 })
        .lean<Detail[]>()
        .cursor();
      for await (const detail of cursor as AsyncIterable<Detail>) {
        yield {
          id: detail._id.toHexString(),
          shortId: shortId(detail._id),
          diagramId: detail.diagramId.toHexString(),
          diagramName: diagramNames.get(detail.diagramId.toHexString()) ?? '',
          activityKey: detail.activityKey,
          activityLabel: labels.get(detail.activityKey) ?? null,
          given: detail.given,
          when: detail.when,
          then: detail.then,
          type: detail.type,
          priority: detail.priority,
          authorRole: detail.authorRole,
          tags: detail.tags,
          status: detail.status,
          duplicateOfShortId: detail.duplicateOf ? shortId(detail.duplicateOf) : null,
          discardReason: detail.discardReason,
          voteCount: detail.voteCount,
          commentCount: detail.commentCount,
          authorName: names.get(detail.authorId.toHexString()) ?? '',
          createdAt: detail.createdAt,
          updatedAt: detail.updatedAt,
        };
      }
    },
  };
}
