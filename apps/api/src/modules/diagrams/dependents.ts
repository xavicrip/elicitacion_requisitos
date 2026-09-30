import fp from 'fastify-plugin';
import type { Types } from 'mongoose';

/** Actividad de la que dependen otros datos (requisitos en la 004…). */
export type ActivityRef = {
  projectId: Types.ObjectId;
  versionId: Types.ObjectId;
  activityId: Types.ObjectId;
  /** Estable entre versiones: el ancla habitual de los dependientes. */
  key: string;
};

export type ActivityDependents = {
  count(ref: ActivityRef): Promise<number>;
  /** Idempotente: se llama al eliminar la actividad con `?confirm=true`. */
  remove(ref: ActivityRef): Promise<void>;
};

export type DependentsCount = { total: number; byName: Record<string, number> };

declare module 'fastify' {
  interface FastifyInstance {
    /** Cada feature registra lo que depende de una actividad sin modificar el módulo de diagramas. */
    registerActivityDependents(name: string, dependents: ActivityDependents): void;
    activityDependents: {
      count(ref: ActivityRef): Promise<DependentsCount>;
      remove(ref: ActivityRef): Promise<void>;
    };
  }
}

/**
 * Registro de dependientes de actividades: eliminar una actividad con dependientes exige
 * confirmación (`409` con el conteo) y, con ella, los elimina primero.
 */
export const activityDependentsPlugin = fp(
  async (app) => {
    const registry = new Map<string, ActivityDependents>();

    app.decorate('registerActivityDependents', (name: string, dependents: ActivityDependents) => {
      if (registry.has(name)) throw new Error(`Dependiente de actividades duplicado: ${name}`);
      registry.set(name, dependents);
    });

    app.decorate('activityDependents', {
      async count(ref: ActivityRef) {
        const byName: Record<string, number> = {};
        for (const [name, dependents] of registry) byName[name] = await dependents.count(ref);
        return { total: Object.values(byName).reduce((sum, n) => sum + n, 0), byName };
      },
      async remove(ref: ActivityRef) {
        for (const dependents of registry.values()) await dependents.remove(ref);
      },
    });
  },
  { name: 'activity-dependents' },
);
