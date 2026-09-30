import type { Connection, Model, Schema } from 'mongoose';

/**
 * Opciones comunes de los esquemas: los índices los crean las migraciones
 * (`apps/api/migrations/`), no Mongoose, para que existan con sus nombres y opciones exactos.
 */
export const SCHEMA_OPTIONS = {
  autoIndex: false,
  autoCreate: false,
  timestamps: true,
  versionKey: false,
} as const;

/** Modelo registrado una sola vez por conexión (la app y las pruebas crean varias). */
export function modelFor<T>(
  connection: Connection,
  name: string,
  schema: Schema<T>,
  collection: string,
): Model<T> {
  return (
    (connection.models[name] as Model<T> | undefined) ??
    connection.model<T>(name, schema, collection)
  );
}
