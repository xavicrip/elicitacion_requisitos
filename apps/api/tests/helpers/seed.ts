import type { ProjectStatus, Role } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { projectsModel, type Project } from '../../src/modules/projects/model';
import type { TestUser } from './users';

type SeedOptions = {
  name?: string;
  status?: ProjectStatus | 'deleting';
  /** Miembros y su rol; el primero con `admin` es el creador. */
  members: Array<[TestUser, Role]>;
};

/**
 * Crea un proyecto directamente en la base de datos, con los miembros indicados. Permite probar
 * permisos sin depender de las invitaciones (que llegan con la US3).
 */
export async function seedProject(app: FastifyInstance, options: SeedOptions): Promise<string> {
  const { name = `Proyecto ${new Types.ObjectId().toHexString()}`, status = 'draft' } = options;
  const owner = options.members.find(([, role]) => role === 'admin')?.[0];
  if (!owner) throw new Error('Un proyecto necesita al menos un Administrador');
  const project = await projectsModel(app.mongo).create({
    name,
    status,
    ownerId: new Types.ObjectId(owner.id),
    members: options.members.map(([user, role]) => ({
      userId: new Types.ObjectId(user.id),
      role,
      joinedAt: new Date(),
    })),
  } satisfies Partial<Project>);
  return project._id.toHexString();
}
