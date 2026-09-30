import type { ProjectStatus } from '@reqcanvas/shared';
import type { preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { isValidObjectId } from 'mongoose';
import { HttpError } from '../lib/errors.js';
import { projectsModel, type Member, type Project } from '../modules/projects/model.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Proyecto de la ruta, cargado por `requireProjectRole`. */
    project?: Project;
    /** Membresía del usuario autenticado en `project`. */
    membership?: Member;
  }
  interface FastifyInstance {
    /** 404 si no es miembro (o el proyecto no existe o se está borrando); 403 sin el rol. */
    requireProjectRole(role: 'member' | 'admin'): preHandlerAsyncHookHandler;
    /** 409 si el proyecto no está en `status` (p. ej., escrituras de contenido: `open`). */
    requireProjectStatus(status: ProjectStatus): preHandlerAsyncHookHandler;
  }
}

const notFound = () => new HttpError(404, 'NOT_FOUND', 'Proyecto no encontrado');

/**
 * Guards de autorización por proyecto (research R7, constitución V). Se encadenan después de
 * `requireAuth`. La membresía se consulta en cada petición: no se guarda en el JWT, así que
 * retirar a un miembro surte efecto en su siguiente petición.
 */
export const authorizationPlugin = fp(
  async (app) => {
    const Projects = projectsModel(app.mongo);

    app.decorate(
      'requireProjectRole',
      (role: 'member' | 'admin') =>
        async function requireProjectRole(request) {
          const { projectId } = request.params as { projectId?: string };
          if (!projectId || !isValidObjectId(projectId)) throw notFound();

          const project = await Projects.findOne({
            _id: projectId,
            status: { $ne: 'deleting' },
            'members.userId': request.user.id,
          }).lean<Project>();
          const membership = project?.members.find(
            (m) => m.userId.toHexString() === request.user.id,
          );
          if (!project || !membership) throw notFound();
          if (role === 'admin' && membership.role !== 'admin') {
            throw new HttpError(
              403,
              'FORBIDDEN',
              'Solo un Administrador del proyecto puede realizar esta acción.',
            );
          }
          request.project = project;
          request.membership = membership;
        },
    );

    app.decorate(
      'requireProjectStatus',
      (status: ProjectStatus) =>
        async function requireProjectStatus(request) {
          if (!request.project) throw new Error('requireProjectStatus requiere requireProjectRole');
          if (request.project.status !== status) {
            throw new HttpError(
              409,
              'PROJECT_NOT_OPEN',
              'El proyecto no está abierto: no admite cambios en este momento.',
            );
          }
        },
    );
  },
  { name: 'authorization', dependencies: ['auth', 'mongo'] },
);
