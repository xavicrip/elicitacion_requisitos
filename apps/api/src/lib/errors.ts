import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/**
 * Error de negocio con estado HTTP, código estable y mensaje en español para el usuario
 * (formato `Error` de contracts/auth-projects.openapi.yaml; constitución VI).
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Mensajes genéricos para los errores 4xx de Fastify y sus plugins. */
const CLIENT_ERRORS: Record<number, [code: string, message: string]> = {
  400: ['BAD_REQUEST', 'La petición no es válida.'],
  401: ['UNAUTHORIZED', 'Inicia sesión para continuar.'],
  403: ['FORBIDDEN', 'No tienes permiso para realizar esta acción.'],
  404: ['NOT_FOUND', 'Recurso no encontrado'],
  413: ['PAYLOAD_TOO_LARGE', 'La petición es demasiado grande.'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'El formato de la petición no es válido.'],
  429: ['TOO_MANY_REQUESTS', 'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.'],
};

const INTERNAL: [string, string] = [
  'INTERNAL_ERROR',
  'Ha ocurrido un error inesperado. Inténtalo de nuevo más tarde.',
];

/** `/nested/email` → `nested.email`. */
function fieldName(instancePath: string): string {
  return instancePath.replace(/^\//, '').replaceAll('/', '.') || '_';
}

/** Manejadores de error y de 404 con el formato del contrato. */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).headers(error.headers).send({
        code: error.code,
        message: error.message,
      });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const fields = Object.fromEntries(
        error.validation.map((issue) => [fieldName(issue.instancePath), issue.message ?? '']),
      );
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Revisa los datos del formulario.',
        fields,
      });
    }
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      const [code, message] = CLIENT_ERRORS[status] ?? CLIENT_ERRORS[400]!;
      return reply.code(status).send({ code, message });
    }
    request.log.error({ err: error }, 'Error no controlado');
    const [code, message] = INTERNAL;
    return reply.code(500).send({ code, message });
  });

  app.setNotFoundHandler((_request, reply) => {
    const [code, message] = CLIENT_ERRORS[404]!;
    return reply.code(404).send({ code, message });
  });
}
