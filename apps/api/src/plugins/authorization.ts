import type { ProjectStatus } from '@reqcanvas/shared';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { isValidObjectId, type Types } from 'mongoose';
import { HttpError } from '../lib/errors.js';
import { projectsModel, type Member, type Project } from '../modules/projects/model.js';

type ProjectRole = 'member' | 'admin';

/** Carga el recurso de `:id` (versión, actividad…) con el proyecto al que pertenece. */
export type ResourceLoader = (id: string) => Promise<{ projectId: Types.ObjectId | string } | null>;

declare module 'fastify' {
  interface FastifyRequest {
    /** Proyecto de la ruta, cargado por `requireProjectRole` o `requireResourceProject`. */
    project?: Project;
    /** Membresía del usuario autenticado en `project`. */
    membership?: Member;
    /** Recurso de `:id`, cargado por `requireResourceProject`. */
    resource?: unknown;
  }
  interface FastifyInstance {
    /** 404 si no es miembro (o el proyecto no existe o se está borrando); 403 sin el rol. */
    requireProjectRole(role: ProjectRole): preHandlerAsyncHookHandler;
    /**
     * Para rutas por recurso (`/activities/:id`): carga el recurso, deduce su proyecto y aplica
     * la membresía como `requireProjectRole`; 404 si el recurso no existe o no es miembro.
     */
    requireResourceProject(loader: ResourceLoader, role?: ProjectRole): preHandlerAsyncHookHandler;
    /** 409 si el proyecto no está en `status` o en uno de los estados de la lista. */
    requireProjectStatus(status: ProjectStatus | ProjectStatus[]): preHandlerAsyncHookHandler;
  }
}

const notFound = (message = 'Proyecto no encontrado') => new HttpError(404, 'NOT_FOUND', message);

/**
 * Guards de autorización por proyecto (research R7, constitución V). Se encadenan después de
 * `requireAuth`. La membresía se consulta en cada petición: no se guarda en el JWT, así que
 * retirar a un miembro surte efecto en su siguiente petición.
 */
export const authorizationPlugin = fp(
  async (app) => {
    const Projects = projectsModel(app.mongo);

    /** Carga el proyecto si el usuario es miembro; `false` si no (el llamante elige el 404). */
    async function authorize(
      request: FastifyRequest,
      projectId: Types.ObjectId | string,
      role: ProjectRole,
    ): Promise<boolean> {
      const project = await Projects.findOne({
        _id: projectId,
        status: { $ne: 'deleting' },
        'members.userId': request.user.id,
      }).lean<Project>();
      const membership = project?.members.find((m) => m.userId.toHexString() === request.user.id);
      if (!project || !membership) return false;
      if (role === 'admin' && membership.role !== 'admin') {
        throw new HttpError(
          403,
          'FORBIDDEN',
          'Solo un Administrador del proyecto puede realizar esta acción.',
        );
      }
      request.project = project;
      request.membership = membership;
      return true;
    }

    app.decorate(
      'requireProjectRole',
      (role: ProjectRole) =>
        async function requireProjectRole(request) {
          const { projectId } = request.params as { projectId?: string };
          if (!projectId || !isValidObjectId(projectId)) throw notFound();
          if (!(await authorize(request, projectId, role))) throw notFound();
        },
    );

    app.decorate(
      'requireResourceProject',
      (loader: ResourceLoader, role: ProjectRole = 'member') =>
        async function requireResourceProject(request) {
          const { id } = request.params as { id?: string };
          const missing = () => notFound('Recurso no encontrado');
          if (!id || !isValidObjectId(id)) throw missing();
          const resource = await loader(id);
          if (!resource || !(await authorize(request, resource.projectId, role))) throw missing();
          request.resource = resource;
        },
    );

    app.decorate('requireProjectStatus', (status: ProjectStatus | ProjectStatus[]) => {
      const allowed = Array.isArray(status) ? status : [status];
      return async function requireProjectStatus(request) {
        if (!request.project) throw new Error('requireProjectStatus requiere cargar el proyecto');
        const current = request.project.status;
        if (allowed.includes(current as ProjectStatus)) return;
        // Las escrituras que admiten el borrador (003) solo se bloquean al cerrar el proyecto.
        if (current === 'closed' && allowed.includes('draft')) {
          throw new HttpError(
            409,
            'PROJECT_CLOSED',
            'El proyecto está cerrado: solo se puede consultar.',
          );
        }
        throw new HttpError(
          409,
          'PROJECT_NOT_OPEN',
          'El proyecto no está abierto: no admite cambios en este momento.',
        );
      };
    });
  },
  { name: 'authorization', dependencies: ['auth', 'mongo'] },
);
