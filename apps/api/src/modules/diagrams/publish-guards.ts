import fp from 'fastify-plugin';
import type { HttpError } from '../../lib/errors.js';
import type { DiagramVersion } from './models/version.js';

/** Condición para publicar: `null` si se cumple, o el error que se devuelve si no. */
export type PublishGuard = (version: DiagramVersion) => Promise<HttpError | null>;

declare module 'fastify' {
  interface FastifyInstance {
    /** Cada feature registra lo que impide publicar sin modificar el módulo de diagramas. */
    registerPublishGuard(name: string, guard: PublishGuard): void;
    publishGuards: {
      /** Lanza el error de la primera condición que no se cumpla. */
      check(version: DiagramVersion): Promise<void>;
    };
  }
}

/**
 * Registro de condiciones de publicación (plan de la 006, ajuste 6), como el de dependientes de
 * actividades: la detección impide publicar con propuestas pendientes (`422`).
 */
export const publishGuardsPlugin = fp(
  async (app) => {
    const registry = new Map<string, PublishGuard>();

    app.decorate('registerPublishGuard', (name: string, guard: PublishGuard) => {
      if (registry.has(name)) throw new Error(`Condición de publicación duplicada: ${name}`);
      registry.set(name, guard);
    });

    app.decorate('publishGuards', {
      async check(version: DiagramVersion) {
        for (const guard of registry.values()) {
          const error = await guard(version);
          if (error) throw error;
        }
      },
    });
  },
  { name: 'publish-guards' },
);
