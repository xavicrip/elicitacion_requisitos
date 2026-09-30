import multipart from '@fastify/multipart';
import {
  DiagramInputSchema,
  DiagramSummarySchema,
  DiagramVersionSchema,
  VersionWithActivitiesSchema,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HttpError } from '../../lib/errors.js';
import type { Diagram } from './models/diagram.js';
import type { DiagramVersion } from './models/version.js';
import { canSeeVersion, diagramsService } from './service.js';
import { MULTIPART_LIMITS, readUpload } from './upload.js';

const ProjectParams = z.object({ projectId: z.string() });
const IdParams = z.object({ id: z.string() });
/** Escrituras de diagramas: en borrador y abierto; un proyecto cerrado es de solo lectura. */
const WRITABLE = ['draft', 'open'] as const;

export const versionNotFound = () => new HttpError(404, 'NOT_FOUND', 'Recurso no encontrado');

/**
 * Rutas de diagramas y versiones (contracts/diagrams.openapi.yaml). Las de recurso
 * (`/diagrams/:id`, `/diagram-versions/:id`) deducen el proyecto con `requireResourceProject`.
 */
export async function diagramRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: MULTIPART_LIMITS });
  const diagrams = diagramsService(app);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const context = (request: Parameters<typeof readUpload>[0]) => ({
    project: request.project!,
    actorId: request.user.id,
    log: request.log,
  });

  routes.get(
    '/projects/:projectId/diagrams',
    {
      preHandler: [app.requireAuth, app.requireProjectRole('member')],
      schema: { params: ProjectParams, response: { 200: z.array(DiagramSummarySchema) } },
    },
    async (request) => diagrams.list(request.project!, request.membership!),
  );

  routes.post(
    '/projects/:projectId/diagrams',
    {
      preHandler: [
        app.requireAuth,
        app.requireProjectRole('admin'),
        app.requireProjectStatus([...WRITABLE]),
      ],
      schema: { params: ProjectParams, response: { 201: DiagramVersionSchema } },
    },
    async (request, reply) => {
      const { fields, file } = await readUpload(request);
      const input = DiagramInputSchema.safeParse({ name: fields.name ?? '' });
      if (!input.success) {
        const message = input.error.issues[0]?.message ?? 'El nombre no es válido.';
        throw new HttpError(400, 'VALIDATION_ERROR', message, {}, { name: message });
      }
      reply.code(201);
      return diagrams.create(input.data.name, file, context(request));
    },
  );

  routes.post(
    '/diagrams/:id/versions',
    {
      preHandler: [
        app.requireAuth,
        app.requireResourceProject(diagrams.loadDiagram, 'admin'),
        app.requireProjectStatus([...WRITABLE]),
      ],
      schema: { params: IdParams, response: { 201: DiagramVersionSchema } },
    },
    async (request, reply) => {
      const { file } = await readUpload(request);
      reply.code(201);
      return diagrams.addVersion(request.resource as Diagram, file, context(request));
    },
  );

  routes.get(
    '/diagram-versions/:id',
    {
      preHandler: [app.requireAuth, app.requireResourceProject(diagrams.loadVersion)],
      schema: { params: IdParams, response: { 200: VersionWithActivitiesSchema } },
    },
    async (request) => {
      const version = request.resource as DiagramVersion;
      if (!canSeeVersion(request.membership!, version)) throw versionNotFound();
      return diagrams.withActivities(version);
    },
  );
}
