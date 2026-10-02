import fp from 'fastify-plugin';
import { HttpError } from '../lib/errors.js';
import type { ActiveFlags } from '../lib/flags.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Flags activos del entorno (`FEATURE_FLAGS` sobre el registro de `@reqcanvas/shared`). */
    flags: ActiveFlags;
  }
}

/** Rutas que oculta cada flag, por su nombre. */
export type FlagGates = Partial<Record<string, RegExp>>;

/**
 * Rutas de cada flag: con el flag desactivado responden 404, como si no existieran
 * (constitución IV: funcionalidad incompleta integrada detrás de un flag). Cada feature añade
 * aquí las suyas mientras su flag exista.
 */
export const GATED_PREFIXES: FlagGates = {
  // Detección asistida (feature 006): iniciar y consultar la detección y revisar propuestas.
  detection:
    /^\/(diagram-versions\/[^/?]+\/(detections|proposals)|proposals|transition-proposals)(\/|\?|$)/,
};

export const featureGatePlugin = fp<{ flags: ActiveFlags; gates?: FlagGates }>(
  async (app, { flags, gates = GATED_PREFIXES }) => {
    app.decorate('flags', flags);
    const active: Record<string, boolean> = flags;
    app.addHook('onRequest', async (request) => {
      for (const [flag, pattern] of Object.entries(gates)) {
        if (pattern && !active[flag] && pattern.test(request.url)) {
          throw new HttpError(404, 'NOT_FOUND', 'Recurso no encontrado');
        }
      }
    });
  },
  { name: 'feature-gate' },
);
