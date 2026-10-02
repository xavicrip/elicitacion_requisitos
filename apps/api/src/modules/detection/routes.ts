import {
  ActivitySchema,
  DetectionJobSchema,
  DetectionStartInputSchema,
  ProposalAcceptInputSchema,
  ProposalsSchema,
} from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { DiagramVersion } from '../diagrams/models/version.js';
import { diagramsService } from '../diagrams/service.js';
import type { ActivityProposalDoc } from './models/activity-proposal.js';
import { detectionService } from './service.js';

const IdParams = z.object({ id: z.string() });
/** Como el editor de la 003: solo en borrador y con el proyecto abierto o en borrador. */
const WRITABLE = ['draft', 'open'] as const;

/**
 * Detección asistida (contracts/detection.openapi.yaml): solo el Administrador, sobre versiones
 * en borrador. Detrás del flag `detection` (`GATED_PREFIXES`).
 */
export async function detectionRoutes(app: FastifyInstance) {
  const detection = detectionService(app);
  const { loadVersion } = diagramsService(app);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const admin = [app.requireAuth, app.requireResourceProject(loadVersion, 'admin')];
  const reviewer = [
    app.requireAuth,
    app.requireResourceProject(detection.loadProposal, 'admin'),
    app.requireProjectStatus([...WRITABLE]),
  ];

  // FR-007: no se publica con propuestas pendientes de revisión.
  app.registerPublishGuard('detection', (version) => detection.pendingError(version._id));

  routes.post(
    '/diagram-versions/:id/detections',
    {
      preHandler: [...admin, app.requireProjectStatus([...WRITABLE])],
      schema: {
        params: IdParams,
        // Sin cuerpo, Fastify entrega `null`: se toman los valores por defecto.
        body: z.preprocess((body) => body ?? {}, DetectionStartInputSchema),
        response: { 202: DetectionJobSchema },
      },
    },
    async (request, reply) => {
      const job = await detection.start(
        request.resource as DiagramVersion,
        { llmRefine: request.body.llmRefine, arrows: request.body.arrows },
        request.user.id,
        app.detection.enqueue,
      );
      return reply.code(202).send(job);
    },
  );

  routes.get(
    '/diagram-versions/:id/detections',
    { preHandler: admin, schema: { params: IdParams, response: { 200: DetectionJobSchema } } },
    async (request) => detection.latest((request.resource as DiagramVersion)._id),
  );

  routes.get(
    '/diagram-versions/:id/proposals',
    { preHandler: admin, schema: { params: IdParams, response: { 200: ProposalsSchema } } },
    async (request) => detection.proposals((request.resource as DiagramVersion)._id),
  );

  routes.post(
    '/diagram-versions/:id/proposals/accept-high',
    {
      preHandler: [...admin, app.requireProjectStatus([...WRITABLE])],
      schema: { params: IdParams, response: { 200: z.object({ accepted: z.number().int() }) } },
    },
    async (request) =>
      detection.acceptHigh((request.resource as DiagramVersion)._id, request.user.id),
  );

  routes.post(
    '/proposals/:id/accept',
    {
      preHandler: reviewer,
      schema: {
        params: IdParams,
        body: z.preprocess((body) => body ?? {}, ProposalAcceptInputSchema),
        response: { 200: ActivitySchema },
      },
    },
    async (request) =>
      detection.accept(request.resource as ActivityProposalDoc, request.body, request.user.id),
  );

  routes.post(
    '/proposals/:id/discard',
    { preHandler: reviewer, schema: { params: IdParams } },
    async (request, reply) => {
      await detection.discard(request.resource as ActivityProposalDoc, request.user.id);
      return reply.code(204).send();
    },
  );
}
