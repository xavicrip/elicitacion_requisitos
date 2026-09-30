import type { FastifyRequest } from 'fastify';
import { HttpError } from '../../lib/errors.js';

/** Límite de la subida (FR-001): `@fastify/multipart` corta el stream al superarlo. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const MULTIPART_LIMITS = {
  fileSize: MAX_UPLOAD_BYTES,
  files: 1,
  fields: 5,
  fieldSize: 1024,
};

const tooLarge = () =>
  new HttpError(413, 'FILE_TOO_LARGE', 'Máximo 10 MB: reduce el tamaño de la imagen.');

/** Lee los campos de texto y el archivo `file` de una petición multipart. */
export async function readUpload(
  request: FastifyRequest,
): Promise<{ fields: Record<string, string>; file: Buffer }> {
  if (!request.isMultipart()) {
    throw new HttpError(400, 'BAD_REQUEST', 'Envía la imagen como multipart/form-data.');
  }
  const fields: Record<string, string> = {};
  let file: Buffer | undefined;
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname === 'file') file = await part.toBuffer();
        else part.file.resume();
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge();
    throw error;
  }
  if (!file || file.length === 0) {
    throw new HttpError(
      400,
      'FILE_REQUIRED',
      'Selecciona la imagen del diagrama.',
      {},
      {
        file: 'Selecciona la imagen del diagrama.',
      },
    );
  }
  return { fields, file };
}
