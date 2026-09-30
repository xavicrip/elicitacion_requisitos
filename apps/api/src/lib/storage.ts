import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { StorageConfig } from '../app.js';

export type StoredObject = {
  body: Readable;
  etag: string;
  contentLength: number;
  contentType: string;
};

export type Storage = {
  bucket: string;
  put(key: string, body: Buffer, contentType: string): Promise<{ etag: string }>;
  /** `null` si el objeto no existe. */
  getStream(key: string): Promise<StoredObject | null>;
  /** Borra todos los objetos del prefijo (paginando); devuelve cuántos borró. */
  deletePrefix(prefix: string): Promise<number>;
  /** Crea el bucket si no existe (solo local y CI: `S3_CREATE_BUCKET`). */
  ensureBucket(): Promise<void>;
  /** Solo pruebas: elimina el bucket (vacío). */
  deleteBucket(): Promise<void>;
  /** Check de `/health/deep`: el bucket existe y las credenciales valen. */
  ping(): Promise<void>;
  destroy(): void;
};

const status = (error: unknown) =>
  error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;

/** Cliente S3 único por app (Railway Buckets en staging/production, RustFS en local y CI). */
export function createStorage(config: StorageConfig): Storage {
  const { bucket } = config;
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: 2,
  });

  return {
    bucket,

    async put(key, body, contentType) {
      const result = await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
      return { etag: result.ETag ?? '' };
    },

    async getStream(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return {
          body: result.Body as Readable,
          etag: result.ETag ?? '',
          contentLength: result.ContentLength ?? 0,
          contentType: result.ContentType ?? 'application/octet-stream',
        };
      } catch (error) {
        if (error instanceof NoSuchKey || status(error) === 404) return null;
        throw error;
      }
    },

    async deletePrefix(prefix) {
      let deleted = 0;
      let token: string | undefined;
      do {
        // Máximo 1000 claves por página, el mismo límite que DeleteObjects.
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        const keys = (page.Contents ?? []).flatMap(({ Key }) => (Key ? [{ Key }] : []));
        if (keys.length > 0) {
          await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: keys, Quiet: true },
            }),
          );
          deleted += keys.length;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return deleted;
    },

    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (error) {
        if (status(error) !== 404) throw error;
        await client.send(new CreateBucketCommand({ Bucket: bucket })).catch((createError) => {
          // Otra instancia lo creó a la vez.
          if (status(createError) !== 409) throw createError;
        });
      }
    },

    async deleteBucket() {
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    },

    async ping() {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    },

    destroy() {
      client.destroy();
    },
  };
}
