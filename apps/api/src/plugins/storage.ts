import fp from 'fastify-plugin';
import type { StorageConfig } from '../app.js';
import { createStorage, type Storage } from '../lib/storage.js';

declare module 'fastify' {
  interface FastifyInstance {
    storage: Storage;
  }
}

/**
 * Bucket de las imágenes de diagramas (feature 003). Como Mongo y Redis, no bloquea el arranque
 * si el bucket no responde: lo informa el check `storage` de `/health/deep`.
 */
export const storagePlugin = fp<StorageConfig>(
  async (app, config) => {
    const storage = createStorage(config);
    if (config.createBucket) {
      await storage.ensureBucket().catch((error: Error) => {
        app.log.warn({ err: { name: error.name } }, 'No se pudo crear el bucket S3');
      });
    }
    app.decorate('storage', storage);
    app.addHook('onClose', async () => {
      storage.destroy();
    });
  },
  { name: 'storage' },
);
