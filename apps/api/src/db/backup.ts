import { gunzipSync, gzipSync } from 'node:zlib';
import { BSON, type Db, type Document } from 'mongodb';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const { EJSON } = BSON;

/** Colecciones que no se respaldan: el lock de migraciones y el registro de restauraciones. */
const EXCLUDED = new Set(['changelog_lock', 'ops_restores']);

type CollectionLine = { collection: string; options: Document; indexes: Document[] };
type DocumentLine = { in: string; doc: Document };

/**
 * Respaldo lógico de la base de datos: NDJSON comprimido con gzip, una línea por colección
 * (opciones e índices) y otra por documento en EJSON canónico, que conserva los tipos BSON.
 * No requiere `mongodump`: se ejecuta en el propio contenedor de api (preDeployCommand).
 */
export async function dumpDatabase(db: Db): Promise<Buffer> {
  const lines: string[] = [];
  const collections = await db
    .listCollections({ type: 'collection' }, { nameOnly: false })
    .toArray();
  for (const { name, options } of collections) {
    if (name.startsWith('system.') || EXCLUDED.has(name)) continue;
    const collection = db.collection(name);
    const indexes = (await collection.indexes()).filter((index) => index.name !== '_id_');
    const header: CollectionLine = { collection: name, options: options ?? {}, indexes };
    lines.push(EJSON.stringify(header, { relaxed: false }));
    for await (const doc of collection.find()) {
      const line: DocumentLine = { in: name, doc };
      lines.push(EJSON.stringify(line, { relaxed: false }));
    }
  }
  return gzipSync(lines.join('\n'));
}

/**
 * Restaura un respaldo de `dumpDatabase`: cada colección respaldada se borra y se recrea con
 * sus opciones, índices y documentos. Las colecciones que no están en el respaldo no se tocan.
 */
export async function restoreDatabase(db: Db, archive: Buffer): Promise<string[]> {
  const text = gunzipSync(archive).toString('utf8');
  const restored: string[] = [];
  let batch: { name: string; docs: Document[] } | undefined;

  const flush = async () => {
    if (batch && batch.docs.length > 0) await db.collection(batch.name).insertMany(batch.docs);
    batch = undefined;
  };

  for (const raw of text.split('\n')) {
    if (!raw) continue;
    const line = EJSON.parse(raw, { relaxed: false }) as CollectionLine | DocumentLine;
    if ('collection' in line) {
      await flush();
      const { collection: name, options, indexes } = line;
      await db.collection(name).drop().catch(ignoreNamespaceNotFound);
      await db.createCollection(name, options);
      if (indexes.length > 0) {
        await db
          .collection(name)
          .createIndexes(
            indexes.map(({ v: _v, ns: _ns, ...index }) => index as { key: Document; name: string }),
          );
      }
      restored.push(name);
      batch = { name, docs: [] };
    } else {
      if (!batch || batch.name !== line.in) throw new Error('Respaldo con formato inválido');
      batch.docs.push(line.doc);
      if (batch.docs.length >= 1000) {
        await db.collection(batch.name).insertMany(batch.docs);
        batch.docs = [];
      }
    }
  }
  await flush();
  return restored;
}

function ignoreNamespaceNotFound(error: { code?: number }): void {
  if (error.code !== 26) throw error;
}

/** Almacén de respaldos: el bucket S3 del entorno (Railway Buckets; RustFS en local y CI). */
export type BackupStore = {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  latestKey(): Promise<string | undefined>;
};

export const BACKUP_PREFIX = 'mongo-backups/';

export type S3Settings = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/** Lee la configuración del bucket; devuelve las variables que faltan si está incompleta. */
export function s3SettingsFromEnv(
  env: Record<string, string | undefined>,
): { settings: S3Settings } | { missing: string[] } {
  const names = [
    'BACKUP_S3_ENDPOINT',
    'BACKUP_S3_BUCKET',
    'BACKUP_S3_ACCESS_KEY_ID',
    'BACKUP_S3_SECRET_ACCESS_KEY',
  ];
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) return { missing };
  return {
    settings: {
      endpoint: env.BACKUP_S3_ENDPOINT!,
      bucket: env.BACKUP_S3_BUCKET!,
      region: env.BACKUP_S3_REGION || 'auto',
      accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID!,
      secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY!,
      forcePathStyle: env.BACKUP_S3_FORCE_PATH_STYLE === 'true',
    },
  };
}

export function s3BackupStore(settings: S3Settings): BackupStore {
  const client = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
  const Bucket = settings.bucket;
  return {
    async put(key, body) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: 'application/gzip' }),
      );
    },
    async get(key) {
      const response = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await response.Body!.transformToByteArray());
    },
    async latestKey() {
      // Las claves empiezan por un timestamp ISO: el orden lexicográfico es el cronológico.
      let latest: string | undefined;
      let ContinuationToken: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket, Prefix: BACKUP_PREFIX, ContinuationToken }),
        );
        for (const { Key } of page.Contents ?? []) {
          if (Key && (!latest || Key > latest)) latest = Key;
        }
        ContinuationToken = page.NextContinuationToken;
      } while (ContinuationToken);
      return latest;
    },
  };
}

/** Clave del respaldo: `mongo-backups/<timestamp ISO>-<versión>.ndjson.gz`. */
export function backupKey(version: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const safeVersion = version.replace(/[^\w.-]/g, '_');
  return `${BACKUP_PREFIX}${stamp}-${safeVersion}.ndjson.gz`;
}
