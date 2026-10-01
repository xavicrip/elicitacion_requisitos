import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import { usersModel } from '../users/model.js';

/** Nombre que se muestra si la cuenta ya no existe. */
export const UNKNOWN_USER = 'Usuario eliminado';

/**
 * Nombres de usuario por id. También los de miembros retirados del proyecto: su cuenta sigue
 * existiendo y sus aportes conservan su nombre (edge case de la spec).
 */
export async function userNames(
  app: FastifyInstance,
  ids: Types.ObjectId[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map((id) => id.toHexString()))];
  const users = await usersModel(app.mongo)
    .find({ _id: { $in: unique } }, { name: 1 })
    .lean<Array<{ _id: Types.ObjectId; name: string }>>();
  return new Map(users.map((user) => [user._id.toHexString(), user.name]));
}

export const userRef = (names: Map<string, string>, id: Types.ObjectId) => ({
  id: id.toHexString(),
  name: names.get(id.toHexString()) ?? UNKNOWN_USER,
});
