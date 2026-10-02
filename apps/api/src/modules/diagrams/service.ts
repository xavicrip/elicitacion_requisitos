import type { DiagramSummary, VersionWithActivities } from '@reqcanvas/shared';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { HttpError } from '../../lib/errors.js';
import { processImage } from '../../lib/image-pipeline.js';
import { auditService } from '../audit/service.js';
import type { Member, Project } from '../projects/model.js';
import { projectsModel } from '../projects/model.js';
import { imageUrl, toActivityDto, toVersionDto } from './dto.js';
import { activitiesModel, type Activity } from './models/activity.js';
import { diagramsModel, type Diagram } from './models/diagram.js';
import { versionsModel, type DiagramVersion } from './models/version.js';

/** Prefijo de los objetos de un proyecto: la cascada lo borra entero (plan ajuste 6). */
export const projectPrefix = (projectId: Types.ObjectId | string) => `projects/${projectId}/`;
const versionPrefix = (projectId: Types.ObjectId, versionId: Types.ObjectId) =>
  `${projectPrefix(projectId)}diagrams/${versionId}/`;

const draftExists = () =>
  new HttpError(
    409,
    'DRAFT_EXISTS',
    'Este diagrama ya tiene una versión en borrador. Publícala antes de subir otra.',
  );

const versionNotDraft = () =>
  new HttpError(409, 'VERSION_NOT_DRAFT', 'Esta versión ya no está en borrador.');

const isDuplicateKey = (error: unknown) => (error as { code?: number }).code === 11000;

/** Quien no es Administrador solo ve lo publicado (FR-013 de la 002, US3 escenario 2). */
export const canSeeVersion = (membership: Member, version: Pick<DiagramVersion, 'status'>) =>
  membership.role === 'admin' || version.status === 'published';

type UploadContext = { project: Project; actorId: string; log: FastifyBaseLogger };

export function diagramsService(app: FastifyInstance) {
  const Diagrams = diagramsModel(app.mongo);
  const Versions = versionsModel(app.mongo);
  const Activities = activitiesModel(app.mongo);
  const Projects = projectsModel(app.mongo);
  const audit = auditService(app.mongo, app.log);

  /**
   * Procesa la imagen, sube sus tres objetos y crea el documento de la versión en borrador.
   * Si algo falla después de subir (p. ej., otra subida creó antes el borrador), borra lo subido.
   */
  async function createVersion(
    diagram: Pick<Diagram, '_id' | 'projectId'>,
    number: number,
    file: Buffer,
    { actorId, log }: UploadContext,
  ): Promise<DiagramVersion> {
    const image = await processImage(file);
    const versionId = new Types.ObjectId();
    const prefix = versionPrefix(diagram.projectId, versionId);
    const keys = {
      originalKey: `${prefix}original.${image.original.ext}`,
      displayKey: `${prefix}display.webp`,
      thumbKey: `${prefix}thumb.webp`,
    };
    try {
      await Promise.all([
        app.storage.put(keys.originalKey, image.original.buffer, image.original.mime),
        app.storage.put(keys.displayKey, image.display.buffer, 'image/webp'),
        app.storage.put(keys.thumbKey, image.thumb.buffer, 'image/webp'),
      ]);
      const version = await Versions.create({
        _id: versionId,
        diagramId: diagram._id,
        projectId: diagram.projectId,
        number,
        status: 'draft',
        image: {
          ...keys,
          mime: image.original.mime,
          width: image.display.width,
          height: image.display.height,
          bytes: file.length,
        },
        createdBy: new Types.ObjectId(actorId),
      });
      log.info(
        {
          diagramId: diagram._id.toHexString(),
          versionId: versionId.toHexString(),
          bytes: file.length,
          width: image.display.width,
          height: image.display.height,
          durationMs: image.durationMs,
        },
        'Imagen de diagrama procesada',
      );
      return version.toObject();
    } catch (error) {
      await app.storage.deletePrefix(prefix).catch((cleanupError: Error) => {
        log.error(
          { err: { name: cleanupError.name }, prefix },
          'No se pudieron borrar los objetos de una subida fallida',
        );
      });
      if (isDuplicateKey(error)) throw draftExists();
      throw error;
    }
  }

  /**
   * FR-008: la versión nueva parte de las actividades de la anterior, con la misma `key` (el
   * ancla de los requisitos de la 004), `_id` nuevos y `rev` reiniciado.
   */
  async function copyActivities(from: Types.ObjectId, to: Types.ObjectId) {
    const activities = await Activities.find({ versionId: from }).lean<Activity[]>();
    if (activities.length === 0) return;
    await Activities.insertMany(
      activities.map(({ _id: _omit, createdAt: _c, updatedAt: _u, ...activity }) => ({
        ...activity,
        versionId: to,
        rev: 0,
      })),
    );
  }

  const touchProject = (projectId: Types.ObjectId) =>
    Projects.updateOne({ _id: projectId }, { $set: { lastActivityAt: new Date() } });

  return {
    /** Diagramas del proyecto; un Participante solo ve los que tienen una versión publicada. */
    async list(project: Project, membership: Member): Promise<DiagramSummary[]> {
      const isAdmin = membership.role === 'admin';
      const diagrams = await Diagrams.find({
        projectId: project._id,
        ...(isAdmin ? {} : { publishedVersionId: { $ne: null } }),
      })
        .sort({ order: 1, _id: 1 })
        .lean<Diagram[]>();
      const drafts = isAdmin
        ? await Versions.find(
            { diagramId: { $in: diagrams.map((d) => d._id) }, status: 'draft' },
            { diagramId: 1 },
          ).lean<Array<Pick<DiagramVersion, '_id' | 'diagramId'>>>()
        : [];
      const draftOf = new Map(drafts.map((v) => [v.diagramId.toHexString(), v._id.toHexString()]));

      return diagrams.map((diagram) => {
        const publishedVersionId = diagram.publishedVersionId?.toHexString() ?? null;
        const draftVersionId = draftOf.get(diagram._id.toHexString()) ?? null;
        const shown = isAdmin ? (draftVersionId ?? publishedVersionId) : publishedVersionId;
        return {
          id: diagram._id.toHexString(),
          name: diagram.name,
          order: diagram.order,
          publishedVersionId,
          ...(isAdmin ? { draftVersionId } : {}),
          ...(shown ? { thumbUrl: imageUrl(shown, 'thumb') } : {}),
        };
      });
    },

    /** Crea el diagrama con su versión 1 en borrador. */
    async create(name: string, file: Buffer, context: UploadContext) {
      const { project, actorId } = context;
      const order = await Diagrams.countDocuments({ projectId: project._id });
      const diagram = await Diagrams.create({ projectId: project._id, name, order });
      try {
        const version = await createVersion(diagram, 1, file, context);
        await touchProject(project._id);
        await audit.record('diagram.created', {
          actorId: new Types.ObjectId(actorId),
          projectId: project._id,
          entity: { type: 'diagram', id: diagram._id.toHexString() },
          diff: { name, versionId: version._id.toHexString() },
        });
        return toVersionDto(version);
      } catch (error) {
        await Diagrams.deleteOne({ _id: diagram._id });
        throw error;
      }
    },

    /** Sube la versión siguiente; 409 si ya hay un borrador (también ante subidas simultáneas). */
    async addVersion(diagram: Diagram, file: Buffer, context: UploadContext) {
      if (await Versions.exists({ diagramId: diagram._id, status: 'draft' })) throw draftExists();
      const last = await Versions.findOne({ diagramId: diagram._id }, { number: 1 })
        .sort({ number: -1 })
        .lean<Pick<DiagramVersion, '_id' | 'number'>>();
      const number = (last?.number ?? 0) + 1;
      // Una subida simultánea choca con el índice de borrador o con el del número: 409.
      const version = await createVersion(diagram, number, file, context);
      if (last) await copyActivities(last._id, version._id);
      await touchProject(diagram.projectId);
      await audit.record('diagram.version_uploaded', {
        actorId: new Types.ObjectId(context.actorId),
        projectId: diagram.projectId,
        entity: { type: 'diagram_version', id: version._id.toHexString() },
        diff: { diagramId: diagram._id.toHexString(), number },
      });
      return toVersionDto(version);
    },

    /**
     * Publica el borrador (FR-007): exige al menos una actividad, archiva la versión publicada
     * anterior y apunta el diagrama a esta. La reclama antes con su `rev`, así que de dos
     * publicaciones simultáneas solo una sigue adelante (la otra, 409).
     */
    async publish(version: DiagramVersion, actorId: string) {
      if (version.status !== 'draft') throw versionNotDraft();
      if (!(await Activities.exists({ versionId: version._id }))) {
        throw new HttpError(
          422,
          'NO_ACTIVITIES',
          'Marca al menos una actividad antes de publicar el diagrama.',
        );
      }
      // Condiciones de otras features (la 006 bloquea con propuestas pendientes).
      await app.publishGuards.check(version);
      const claimed = await Versions.updateOne(
        { _id: version._id, status: 'draft', rev: version.rev },
        { $inc: { rev: 1 } },
      );
      if (claimed.modifiedCount === 0) throw versionNotDraft();

      await Versions.updateMany(
        { diagramId: version.diagramId, status: 'published' },
        { $set: { status: 'archived' } },
      );
      const published = await Versions.findOneAndUpdate(
        { _id: version._id, status: 'draft' },
        { $set: { status: 'published', publishedAt: new Date() } },
        { new: true },
      ).lean<DiagramVersion>();
      if (!published) throw versionNotDraft();
      await Diagrams.updateOne(
        { _id: version.diagramId },
        { $set: { publishedVersionId: version._id } },
      );
      await touchProject(version.projectId);
      await audit.record('diagram.published', {
        actorId: new Types.ObjectId(actorId),
        projectId: version.projectId,
        entity: { type: 'diagram_version', id: version._id.toHexString() },
        diff: { diagramId: version.diagramId.toHexString(), number: version.number },
      });
      await app.domainEvents.emit('diagram.published', {
        projectId: version.projectId.toHexString(),
        diagramId: version.diagramId.toHexString(),
        versionId: version._id.toHexString(),
        actorId,
        at: new Date().toISOString(),
      });
      return toVersionDto(published);
    },

    async withActivities(version: DiagramVersion): Promise<VersionWithActivities> {
      const activities = await Activities.find({ versionId: version._id })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
      return { ...toVersionDto(version), activities: activities.map(toActivityDto) };
    },

    loadDiagram: (id: string) => Diagrams.findById(id).lean<Diagram>(),
    loadVersion: (id: string) => Versions.findById(id).lean<DiagramVersion>(),
  };
}
