import {
  LoginInputSchema,
  RegisterInputSchema,
  SessionSchema,
  SessionUserSchema,
} from '@reqcanvas/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AuthConfig } from '../../app.js';
import { clientIp } from '../../lib/client-ip.js';
import { AUTH_RATE_LIMIT } from '../../plugins/rate-limit.js';
import { authService, type IssuedSession } from './service.js';

/** Cookie del refresh token (research R1). La ruta es la que ve el navegador (proxy /api). */
const COOKIE = 'rt';
const COOKIE_PATH = '/api/auth';

/** Rutas de autenticación (contracts/auth-projects.openapi.yaml: /auth/*, /me). */
export async function authRoutes(app: FastifyInstance, config: AuthConfig) {
  const auth = authService(app, config);
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const cookieOptions = {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict' as const,
    path: COOKIE_PATH,
  };
  const rateLimit = { rateLimit: AUTH_RATE_LIMIT };

  const sendSession = (reply: FastifyReply, { session, refreshToken }: IssuedSession) => {
    reply.setCookie(COOKIE, refreshToken, {
      ...cookieOptions,
      maxAge: config.refreshTtlDays * 24 * 60 * 60,
    });
    return session;
  };

  routes.post(
    '/auth/register',
    { config: rateLimit, schema: { body: RegisterInputSchema, response: { 201: SessionSchema } } },
    async (request, reply) => {
      const issued = await auth.register(request.body);
      reply.code(201);
      return sendSession(reply, issued);
    },
  );

  routes.post(
    '/auth/login',
    { config: rateLimit, schema: { body: LoginInputSchema, response: { 200: SessionSchema } } },
    async (request, reply) => sendSession(reply, await auth.login(request.body, clientIp(request))),
  );

  routes.post(
    '/auth/refresh',
    { config: rateLimit, schema: { response: { 200: SessionSchema } } },
    async (request, reply) => sendSession(reply, await auth.refresh(request.cookies[COOKIE])),
  );

  routes.post('/auth/logout', { config: rateLimit }, async (request, reply) => {
    await auth.logout(request.cookies[COOKIE]);
    reply.clearCookie(COOKIE, cookieOptions);
    return reply.code(204).send();
  });

  routes.get(
    '/me',
    { preHandler: app.requireAuth, schema: { response: { 200: SessionUserSchema } } },
    async (request) => auth.me(request.user.id),
  );
}
