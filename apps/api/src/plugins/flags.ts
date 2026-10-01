import fp from 'fastify-plugin';
import { HttpError } from '../lib/errors.js';
import type { ActiveFlags } from '../lib/flags.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Flags activos del entorno (`FEATURE_FLAGS` sobre el registro de `@reqcanvas/shared`). */
    flags: ActiveFlags;
  }
}

/**
 * Rutas de cada flag: con el flag desactivado responden 404, como si no existieran
 * (constitución IV: funcionalidad incompleta integrada detrás de un flag).
 */
const GATED_PREFIXES: Partial<Record<keyof ActiveFlags, RegExp>> = {
  accounts: /^\/(auth|me|projects|invitations)(\/|\?|$)/,
  diagrams: /^\/(projects\/[^/?]+\/diagrams|diagrams|diagram-versions|activities)(\/|\?|$)/,
};

export const featureGatePlugin = fp<{ flags: ActiveFlags }>(
  async (app, { flags }) => {
    app.decorate('flags', flags);
    app.addHook('onRequest', async (request) => {
      for (const [flag, pattern] of Object.entries(GATED_PREFIXES)) {
        if (!flags[flag as keyof ActiveFlags] && pattern.test(request.url)) {
          throw new HttpError(404, 'NOT_FOUND', 'Recurso no encontrado');
        }
      }
    });
  },
  { name: 'feature-gate' },
);
