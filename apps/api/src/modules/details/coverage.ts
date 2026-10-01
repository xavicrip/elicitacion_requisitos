import { detailSummary, type ActivityCoverage, type DetailStatus } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import { activitiesModel } from '../diagrams/models/activity.js';
import type { DiagramVersion } from '../diagrams/models/version.js';
import { detailsModel, type Detail } from './models/detail.js';

type CoverageDetail = Pick<
  Detail,
  '_id' | 'activityKey' | 'status' | 'duplicateOf' | 'voteCount' | 'when' | 'then' | 'createdAt'
>;

const TOP = 3;
const PROJECTION = {
  activityKey: 1,
  status: 1,
  duplicateOf: 1,
  voteCount: 1,
  when: 1,
  then: 1,
  createdAt: 1,
};

/** Cuentan los detalles vivos: ni descartados ni duplicados (research R6). */
const counts = (detail: CoverageDetail) =>
  detail.status !== 'discarded' && detail.status !== 'duplicate';

/**
 * Cobertura por actividad de una versión (research R7): total, conteo por estado, votos
 * efectivos y los 3 resúmenes más votados para las notas. Solo las `activityKey` de esa versión:
 * los huérfanos no cuentan.
 */
export async function coverageOf(
  app: FastifyInstance,
  version: DiagramVersion,
): Promise<ActivityCoverage[]> {
  const activities = await activitiesModel(app.mongo)
    .find({ versionId: version._id }, { key: 1 })
    .sort({ createdAt: 1, _id: 1 })
    .lean<Array<{ key: string }>>();
  const keys = activities.map((activity) => activity.key);
  const Details = detailsModel(app.mongo);
  const details = await Details.find(
    { diagramId: version.diagramId, activityKey: { $in: keys } },
    PROJECTION,
  ).lean<CoverageDetail[]>();

  // Votos efectivos por detalle: los suyos más los de sus duplicados, estén donde estén.
  const votes = new Map(details.map((d) => [d._id.toHexString(), d.voteCount]));
  const duplicates = await Details.find(
    { status: 'duplicate', duplicateOf: { $in: details.map((d) => d._id) } },
    { duplicateOf: 1, voteCount: 1 },
  ).lean<Array<{ duplicateOf: Types.ObjectId; voteCount: number }>>();
  for (const duplicate of duplicates) {
    const id = duplicate.duplicateOf.toHexString();
    votes.set(id, (votes.get(id) ?? 0) + duplicate.voteCount);
  }

  const byKey = new Map<string, CoverageDetail[]>(keys.map((key) => [key, []]));
  for (const detail of details) byKey.get(detail.activityKey)?.push(detail);

  return keys.map((activityKey) => {
    const all = byKey.get(activityKey)!;
    const living = all.filter(counts);
    const effective = (detail: CoverageDetail) => votes.get(detail._id.toHexString()) ?? 0;
    const byStatus: Record<DetailStatus, number> = {
      pending: 0,
      validated: 0,
      duplicate: 0,
      discarded: 0,
    };
    for (const detail of all) byStatus[detail.status] += 1;
    const top = [...living]
      .sort((a, b) => effective(b) - effective(a) || b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, TOP)
      .map((detail) => ({ id: detail._id.toHexString(), summary: detailSummary(detail) }));
    return {
      activityKey,
      total: living.length,
      byStatus,
      effectiveVotes: living.reduce((sum, detail) => sum + effective(detail), 0),
      top,
    };
  });
}
