import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { versionsModel } from '../../src/modules/diagrams/models/version';

/** Flags de las pruebas de la 003. */
export const DIAGRAM_FLAGS = 'accounts=true,diagrams=true';

/** Diagramas de ejemplo de `e2e/fixtures/diagrams/` (scripts/fixtures/diagrams.mjs). */
export const fixture = (name: string): Buffer =>
  readFileSync(
    fileURLToPath(new URL(`../../../../e2e/fixtures/diagrams/${name}`, import.meta.url)),
  );

type FilePart = { buffer: Buffer; filename: string; contentType?: string };

/** Cuerpo `multipart/form-data` para `app.inject`. */
export function multipart(fields: Record<string, string>, file?: FilePart) {
  const boundary = `----reqcanvas${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType ?? 'application/octet-stream'}\r\n\r\n`,
      ),
      file.buffer,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** Sube un diagrama nuevo (versión 1 en borrador). */
export function uploadDiagram(
  app: FastifyInstance,
  headers: Record<string, string>,
  projectId: string,
  { name = 'Proceso de compra', file = 'compra-simple.png', buffer = fixture(file) } = {},
) {
  const body = multipart({ name }, { buffer, filename: file, contentType: 'image/png' });
  return app.inject({
    method: 'POST',
    url: `/projects/${projectId}/diagrams`,
    headers: { ...headers, ...body.headers },
    payload: body.payload,
  });
}

/** Sube una versión nueva de un diagrama. */
export function uploadVersion(
  app: FastifyInstance,
  headers: Record<string, string>,
  diagramId: string,
  file = 'compra-simple.png',
) {
  const body = multipart({}, { buffer: fixture(file), filename: file, contentType: 'image/png' });
  return app.inject({
    method: 'POST',
    url: `/diagrams/${diagramId}/versions`,
    headers: { ...headers, ...body.headers },
    payload: body.payload,
  });
}

/** Publica una versión directamente en la base de datos (la publicación llega con la US3). */
export async function markPublished(app: FastifyInstance, versionId: string) {
  const version = await versionsModel(app.mongo).findByIdAndUpdate(
    versionId,
    { $set: { status: 'published', publishedAt: new Date() } },
    { new: true },
  );
  await app.mongo
    .collection('diagrams')
    .updateOne(
      { _id: version!.diagramId },
      { $set: { publishedVersionId: new Types.ObjectId(versionId) } },
    );
}
