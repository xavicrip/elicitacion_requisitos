import type {
  DashboardFilters,
  DescriptiveDashboard,
  DetailStatus,
  DetailType,
  Priority,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { commentsModel } from '../details/models/comment.js';
import { detailsModel } from '../details/models/detail.js';
import { votesModel } from '../details/models/vote.js';
import { activitiesModel } from '../diagrams/models/activity.js';
import { diagramsModel } from '../diagrams/models/diagram.js';
import { detailsQuery, nextDay, zonedDayStart } from './filters.js';
import { analysisSettingsModel, DEFAULT_SCHEDULE } from './models/analysis-settings.js';

const TYPE_LABEL: Record<DetailType, string> = {
  functional: 'Funcional',
  non_functional: 'No funcional',
  business_rule: 'Regla de negocio',
  constraint: 'Restricción',
};
const PRIORITY_LABEL: Record<Priority | 'none', string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: "Won't",
  none: 'Sin prioridad',
};
const STATUS_LABEL: Record<DetailStatus, string> = {
  pending: 'Pendiente',
  validated: 'Validado',
  duplicate: 'Duplicado',
  discarded: 'Descartado',
};

const pct = (part: number, total: number) =>
  total === 0 ? 0 : Math.round((part / total) * 1000) / 10;

type Row = {
  _id: Types.ObjectId;
  activityKey: string;
  type: DetailType;
  priority: Priority | null;
  authorRole: string | null;
  status: DetailStatus;
  authorId: Types.ObjectId;
  createdAt: Date;
};

/**
 * Capa descriptiva del dashboard (US1, FR-002 y FR-003), calculada en cada petición con los
 * filtros: KPIs, distribuciones, serie temporal y cobertura de las actividades publicadas.
 */
export function descriptiveService(app: FastifyInstance) {
  return {
    async compute(
      projectId: Types.ObjectId,
      filters: DashboardFilters,
    ): Promise<DescriptiveDashboard> {
      const settings = await analysisSettingsModel(app.mongo)
        .findOne({ projectId })
        .lean<{ schedule?: { timezone?: string } }>();
      const timeZone = settings?.schedule?.timezone ?? DEFAULT_SCHEDULE.timezone;
      const day = new Intl.DateTimeFormat('en-CA', { timeZone });
      const dayOf = (date: Date) => day.format(date);

      const details = await detailsModel(app.mongo)
        .find(detailsQuery(projectId, filters, timeZone), {
          activityKey: 1,
          type: 1,
          priority: 1,
          authorRole: 1,
          status: 1,
          authorId: 1,
          createdAt: 1,
        })
        .lean<Row[]>();
      const ids = details.map((detail) => detail._id);

      // Votos y comentarios de los detalles filtrados, dentro del rango de fechas.
      const range: Record<string, Date> = {};
      if (filters.from) range.$gte = zonedDayStart(filters.from, timeZone);
      if (filters.to) range.$lt = zonedDayStart(nextDay(filters.to), timeZone);
      const inRange = Object.keys(range).length ? { createdAt: range } : {};
      const [votes, comments] = await Promise.all([
        votesModel(app.mongo)
          .find({ detailId: { $in: ids }, ...inRange }, { userId: 1, createdAt: 1 })
          .lean<Array<{ userId: Types.ObjectId; createdAt: Date }>>(),
        commentsModel(app.mongo)
          .find({ detailId: { $in: ids }, ...inRange }, { authorId: 1, createdAt: 1 })
          .lean<Array<{ authorId: Types.ObjectId; createdAt: Date }>>(),
      ]);

      // Actividades de las versiones publicadas (de los diagramas filtrados).
      const diagramFilter: Record<string, unknown> = {
        projectId,
        publishedVersionId: { $ne: null },
      };
      if (filters.diagramIds) {
        diagramFilter._id = {
          $in: filters.diagramIds
            .filter((id) => Types.ObjectId.isValid(id))
            .map((id) => new Types.ObjectId(id)),
        };
      }
      const diagrams = await diagramsModel(app.mongo)
        .find(diagramFilter, { publishedVersionId: 1 })
        .sort({ createdAt: 1 })
        .lean<Array<{ publishedVersionId: Types.ObjectId }>>();
      const activities = await activitiesModel(app.mongo)
        .find(
          { versionId: { $in: diagrams.map((diagram) => diagram.publishedVersionId) } },
          { key: 1, label: 1 },
        )
        .sort({ createdAt: 1 })
        .lean<Array<{ key: string; label: string }>>();

      const tally = <K extends string>(key: (row: Row) => K) => {
        const map = new Map<K, number>();
        for (const row of details) map.set(key(row), (map.get(key(row)) ?? 0) + 1);
        return map;
      };
      const byActivity = tally((row) => row.activityKey);
      const byType = tally((row) => row.type);
      const byPriority = tally((row) => row.priority ?? 'none');
      const byRole = tally((row) => row.authorRole ?? 'none');
      const byStatus = tally((row) => row.status);

      const people = new Set<string>();
      for (const row of details) people.add(row.authorId.toHexString());
      for (const vote of votes) people.add(vote.userId.toHexString());
      for (const comment of comments) people.add(comment.authorId.toHexString());

      const timeline = new Map<string, { created: number; votes: number; comments: number }>();
      const bump = (date: Date, field: 'created' | 'votes' | 'comments') => {
        const key = dayOf(date);
        const entry = timeline.get(key) ?? { created: 0, votes: 0, comments: 0 };
        entry[field] += 1;
        timeline.set(key, entry);
      };
      for (const row of details) bump(row.createdAt, 'created');
      for (const vote of votes) bump(vote.createdAt, 'votes');
      for (const comment of comments) bump(comment.createdAt, 'comments');

      const covered = activities.filter((activity) => byActivity.has(activity.key)).length;
      return {
        kpis: {
          totalDetails: details.length,
          activeParticipants: people.size,
          coveredActivitiesPct: pct(covered, activities.length),
          validatedPct: pct(byStatus.get('validated') ?? 0, details.length),
        },
        byActivity: activities.map((activity) => ({
          key: activity.key,
          label: activity.label,
          count: byActivity.get(activity.key) ?? 0,
        })),
        byType: (Object.keys(TYPE_LABEL) as DetailType[]).map((key) => ({
          key,
          label: TYPE_LABEL[key],
          count: byType.get(key) ?? 0,
        })),
        byPriority: (Object.keys(PRIORITY_LABEL) as Array<Priority | 'none'>).map((key) => ({
          key,
          label: PRIORITY_LABEL[key],
          count: byPriority.get(key) ?? 0,
        })),
        byRole: [...byRole.entries()]
          .sort(([a, countA], [b, countB]) =>
            a === 'none' ? 1 : b === 'none' ? -1 : countB - countA || a.localeCompare(b),
          )
          .map(([key, count]) => ({ key, label: key === 'none' ? 'Sin rol' : key, count })),
        byStatus: filters.statuses
          .filter((status) => status !== 'duplicate')
          .map((key) => ({ key, label: STATUS_LABEL[key], count: byStatus.get(key) ?? 0 })),
        timeline: [...timeline.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, entry]) => ({ date, ...entry })),
      };
    },
  };
}
