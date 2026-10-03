import {
  EXPORT_INPUT_VERSION,
  type DashboardFilters,
  type ExportInputFile,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { analysisService } from '../dashboard/analysis.service.js';
import { descriptiveService } from '../dashboard/descriptive.service.js';
import { detailsQuery } from '../dashboard/filters.js';
import { analysisRunsModel, type AnalysisRunDoc } from '../dashboard/models/analysis-run.js';
import { detailsModel, type Detail } from '../details/models/detail.js';
import { activitiesModel } from '../diagrams/models/activity.js';
import { diagramsModel } from '../diagrams/models/diagram.js';
import { versionsModel, type DiagramVersion } from '../diagrams/models/version.js';
import { projectsModel } from '../projects/model.js';
import { exportQuery } from './query.js';

export type ReportInput = {
  file: ExportInputFile;
  /** El análisis del que salen los hallazgos, si lo había. */
  analysisRunId: Types.ObjectId | null;
};

/**
 * Archivo de entrada del reporte PDF (contracts/export-job.md): lo que el worker necesita, sin
 * acceso a MongoDB. Los indicadores son la instantánea de `descriptive.service` con los mismos
 * filtros (SC-004) y los hallazgos, el último análisis terminado tal como lo muestra el dashboard.
 * No lleva nombres ni identificadores de personas (plan, ajuste 18).
 */
export function reportInput(app: FastifyInstance) {
  const query = exportQuery(app);

  return async function build(
    projectId: Types.ObjectId,
    filters: DashboardFilters,
    imageTtlSeconds: number,
  ): Promise<ReportInput> {
    const [project, timezone, descriptive] = await Promise.all([
      projectsModel(app.mongo).findById(projectId, { name: 1 }).lean<{ name: string }>(),
      query.timeZone(projectId),
      descriptiveService(app).compute(projectId, filters),
    ]);

    const published = await diagramsModel(app.mongo)
      .find(
        {
          projectId,
          publishedVersionId: { $ne: null },
          ...(filters.diagramIds
            ? { _id: { $in: filters.diagramIds.map((id) => new Types.ObjectId(id)) } }
            : {}),
        },
        { name: 1, publishedVersionId: 1 },
      )
      .sort({ createdAt: 1 })
      .lean<Array<{ _id: Types.ObjectId; name: string; publishedVersionId: Types.ObjectId }>>();
    const versionIds = published.map((diagram) => diagram.publishedVersionId);
    const versions = await versionsModel(app.mongo)
      .find({ _id: { $in: versionIds } }, { image: 1 })
      .lean<Array<Pick<DiagramVersion, '_id' | 'image'>>>();
    const imageOf = new Map(versions.map((version) => [version._id.toHexString(), version.image]));
    const activities = await activitiesModel(app.mongo)
      .find({ versionId: { $in: versionIds } }, { key: 1, label: 1, bbox: 1, versionId: 1 })
      .sort({ 'bbox.y': 1, 'bbox.x': 1 })
      .lean<
        Array<{
          key: string;
          label: string;
          bbox: { x: number; y: number; w: number; h: number };
          versionId: Types.ObjectId;
        }>
      >();
    const countOf = new Map(descriptive.byActivity.map((item) => [item.key, item.count]));

    const diagrams: ExportInputFile['diagrams'] = [];
    for (const diagram of published) {
      const image = imageOf.get(diagram.publishedVersionId.toHexString());
      if (!image) continue;
      diagrams.push({
        id: diagram._id.toHexString(),
        name: diagram.name,
        image: {
          url: await app.storage.presignGet(image.displayKey, imageTtlSeconds),
          width: image.width,
          height: image.height,
        },
        activities: activities
          .filter((activity) => activity.versionId.equals(diagram.publishedVersionId))
          .map(({ key, label, bbox }) => ({
            key,
            label,
            bbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
            detailCount: countOf.get(key) ?? 0,
          })),
      });
    }

    // Los mismos detalles que cuenta el dashboard con esos filtros.
    const details = await detailsModel(app.mongo)
      .find(detailsQuery(projectId, filters, timezone), { authorId: 0 })
      .sort({ diagramId: 1, activityKey: 1, createdAt: 1, _id: 1 })
      .lean<Array<Omit<Detail, 'authorId'>>>();

    const run = await analysisRunsModel(app.mongo)
      .findOne({ projectId, status: 'done' })
      .sort({ createdAt: -1 })
      .lean<AnalysisRunDoc>();
    const analysis = run ? await analysisService(app).toFullDto(run) : null;

    return {
      analysisRunId: analysis?.results ? run!._id : null,
      file: {
        schemaVersion: EXPORT_INPUT_VERSION,
        project: { name: project?.name ?? '', timezone },
        generatedAt: new Date().toISOString(),
        filters,
        descriptive,
        diagrams,
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
        analysis:
          analysis?.results && analysis.finishedAt
            ? {
                finishedAt: analysis.finishedAt,
                stages: analysis.stages,
                results: analysis.results,
              }
            : null,
      },
    };
  };
}
