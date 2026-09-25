import fp from 'fastify-plugin';
import mongoose, { type Connection } from 'mongoose';

declare module 'fastify' {
  interface FastifyInstance {
    mongo: Connection;
  }
}

type MongoOptions = { url: string; dbName: string; timeoutMs: number };

/**
 * Conexión Mongoose compartida. No bloquea el arranque si MongoDB no está disponible:
 * el healthcheck informa `degraded` y la conexión se reintenta sola.
 */
export const mongoPlugin = fp<MongoOptions>(
  async (app, { url, dbName, timeoutMs }) => {
    const connection = mongoose.createConnection(url, {
      dbName,
      serverSelectionTimeoutMS: timeoutMs,
    });
    connection.asPromise().catch((error: Error) => {
      app.log.warn({ err: { name: error.name } }, 'MongoDB no disponible al arrancar');
    });
    app.decorate('mongo', connection);
    app.addHook('onClose', async () => {
      await connection.close();
    });
  },
  { name: 'mongo' },
);

/** Comprueba que MongoDB responde a `ping`. */
export async function pingMongo(connection: Connection): Promise<void> {
  await connection.getClient().db(connection.name).command({ ping: 1 });
}
