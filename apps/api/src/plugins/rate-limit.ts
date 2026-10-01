import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { clientIp } from '../lib/client-ip.js';
import { HttpError } from '../lib/errors.js';

/** Límite de las rutas `/auth/*`: 20 peticiones por minuto e IP (research R4). */
export const AUTH_RATE_LIMIT = { max: 20, timeWindow: '1 minute' } as const;

/**
 * Escrituras de los miembros (detalles, votos y comentarios de la 004): 60 por minuto y usuario,
 * no por IP. Se evalúa en `preHandler`, después de `requireAuth` y de los guards de la ruta, así
 * que ya se conoce al usuario.
 */
export const USER_WRITE_RATE_LIMIT = {
  max: 60,
  timeWindow: '1 minute',
  hook: 'preHandler',
  keyGenerator: (request: FastifyRequest) => `user:${request.user.id}`,
} as const;

type RateLimitOptions = {
  /** Prefijo de las claves en Redis (las pruebas usan uno propio). */
  nameSpace?: string;
};

/**
 * Rate limit con contadores en Redis, compartidos entre réplicas de `api`. No es global: cada
 * ruta lo activa con `config: { rateLimit: AUTH_RATE_LIMIT }`. Si Redis no responde, deja pasar
 * la petición (el bloqueo de cuenta por intentos fallidos es una protección independiente).
 */
export const rateLimitPlugin = fp<RateLimitOptions>(
  async (app, { nameSpace = 'rate-limit:' }) => {
    await app.register(fastifyRateLimit, {
      global: false,
      redis: app.redis,
      nameSpace,
      skipOnError: true,
      // Detrás del proxy de web todas las peticiones llegan desde su IP: se usa X-Real-IP.
      keyGenerator: clientIp,
      errorResponseBuilder: (_request, context) =>
        new HttpError(
          429,
          'TOO_MANY_REQUESTS',
          'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.',
          { 'retry-after': String(Math.ceil(context.ttl / 1000)) },
        ),
    });
  },
  { name: 'rate-limit', dependencies: ['redis'] },
);
