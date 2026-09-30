import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import type { preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { HttpError } from '../lib/errors.js';
import { setCurrentUserId } from '../lib/request-context.js';

type AccessPayload = { sub: string; sid: string };
type AuthUser = { id: string; sid: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessPayload;
    user: AuthUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler: 401 si la petición no trae un access token válido. */
    requireAuth: preHandlerAsyncHookHandler;
    /** Access token de la sesión `sid` del usuario (research R1). */
    signAccessToken(userId: string, sid: string): string;
  }
}

type AuthOptions = {
  secret: string;
  /** Duración del access token (`JWT_ACCESS_TTL`, p. ej. `15m`). */
  accessTtl: string;
};

const unauthorized = () => new HttpError(401, 'UNAUTHORIZED', 'Inicia sesión para continuar.');

/**
 * Autenticación con access token JWT (HS256) en `Authorization: Bearer` y cookies para el
 * refresh token (research R1). El access token no guarda roles: la membresía se consulta en
 * cada petición (contracts/authorization-matrix.md).
 */
export const authPlugin = fp<AuthOptions>(
  async (app, { secret, accessTtl }) => {
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, {
      secret,
      sign: { algorithm: 'HS256', expiresIn: accessTtl },
      verify: { algorithms: ['HS256'] },
      formatUser: ({ sub, sid }) => ({ id: sub, sid }),
    });

    app.decorate('signAccessToken', (userId: string, sid: string) =>
      app.jwt.sign({ sub: userId, sid }),
    );

    app.decorate('requireAuth', async function requireAuth(request) {
      try {
        await request.jwtVerify();
      } catch {
        throw unauthorized();
      }
      request.log = request.log.child({ userId: request.user.id });
      setCurrentUserId(request.user.id);
    });
  },
  { name: 'auth', dependencies: ['observability'] },
);
