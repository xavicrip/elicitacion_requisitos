import type { IncomingMessage } from 'node:http';
import fp from 'fastify-plugin';
import { v7 as uuidv7 } from 'uuid';
import { REQUEST_ID_HEADER } from '../lib/http-client.js';
import { runWithRequestContext } from '../lib/request-context.js';

const VALID_REQUEST_ID = /^[\w.-]{1,64}$/;

/** Reutiliza un `x-request-id` entrante válido o genera un UUID v7. */
export function genReqId(req: IncomingMessage): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  return typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : uuidv7();
}

/** Rutas de log que nunca deben registrarse en claro. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
];

/**
 * Propaga el identificador de petición: lo devuelve en la respuesta y lo deja disponible para
 * las llamadas salientes (`internalFetch`) mediante AsyncLocalStorage.
 */
export const observability = fp(
  async (app) => {
    app.addHook('onRequest', (request, _reply, done) => {
      runWithRequestContext({ requestId: request.id }, done);
    });
    app.addHook('onSend', async (request, reply) => {
      reply.header(REQUEST_ID_HEADER, request.id);
    });
  },
  { name: 'observability' },
);
