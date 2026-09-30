import { randomUUID } from 'node:crypto';
import { text } from 'node:stream/consumers';
import { HealthSchema } from '@reqcanvas/shared';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { buildApp, type StorageConfig } from '../../src/app';
import { createStorage } from '../../src/lib/storage';
import { startFakeAnalytics } from '../helpers/fake-analytics';
import {
  MONGO_TEST_URL,
  REDIS_TEST_URL,
  S3_TEST_CREDENTIALS,
  S3_TEST_URL,
  uniqueDbName,
} from '../helpers/services';

const config = (bucket: string, createBucket = true): StorageConfig => ({
  endpoint: S3_TEST_URL,
  bucket,
  region: 'us-east-1',
  forcePathStyle: true,
  createBucket,
  ...S3_TEST_CREDENTIALS,
});

const bucket = `storage-${randomUUID().slice(0, 8)}`;
const storage = createStorage(config(bucket));
const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

afterAll(async () => {
  await storage.deletePrefix('');
  await storage.deleteBucket();
  storage.destroy();
});

describe('almacenamiento S3 (lib/storage)', () => {
  it('ensureBucket crea el bucket y es idempotente', async () => {
    await storage.ensureBucket();
    await storage.ensureBucket();
    await expect(storage.ping()).resolves.toBeUndefined();
  });

  it('put y getStream devuelven el contenido, el tipo, el tamaño y el ETag', async () => {
    const { etag } = await storage.put('a/hola.txt', Buffer.from('hola'), 'text/plain');
    expect(etag).toMatch(/^".+"$/);
    const object = await storage.getStream('a/hola.txt');
    expect(object).toMatchObject({ etag, contentLength: 4, contentType: 'text/plain' });
    expect(await text(object!.body)).toBe('hola');
  });

  it('getStream devuelve null si el objeto no existe', async () => {
    expect(await storage.getStream('no/existe.png')).toBeNull();
  });

  it('deletePrefix borra todo el prefijo, paginando, y es idempotente', async () => {
    const keys = Array.from({ length: 1005 }, (_, i) => `projects/p1/diagrams/${i}.txt`);
    await Promise.all(keys.map((key) => storage.put(key, Buffer.from('x'), 'text/plain')));
    await storage.put('projects/p2/diagrams/otro.txt', Buffer.from('y'), 'text/plain');

    expect(await storage.listKeys('projects/p1/')).toHaveLength(1005);
    expect(await storage.deletePrefix('projects/p1/')).toBe(1005);
    expect(await storage.deletePrefix('projects/p1/')).toBe(0);
    expect(await storage.getStream('projects/p1/diagrams/0.txt')).toBeNull();
    expect(await storage.getStream('projects/p2/diagrams/otro.txt')).not.toBeNull();
  }, 60_000);
});

async function appWith(storageConfig: StorageConfig) {
  const analytics = await startFakeAnalytics(200);
  const app = await buildApp({
    logLevel: 'silent',
    services: {
      mongoUrl: MONGO_TEST_URL,
      mongoDb: uniqueDbName('storage'),
      redisUrl: REDIS_TEST_URL,
      analyticsUrl: analytics.url,
      version: 'test',
      commit: 'test',
      featureFlags: undefined,
      checkTimeoutMs: 1000,
      storage: storageConfig,
    },
  });
  await app.ready();
  cleanups.push(analytics.close, () => app.close());
  return app;
}

describe('plugin de almacenamiento', () => {
  it('con S3_CREATE_BUCKET crea el bucket al arrancar', async () => {
    const name = `boot-${randomUUID().slice(0, 8)}`;
    const app = await appWith(config(name, true));
    await expect(app.storage.ping()).resolves.toBeUndefined();
    cleanups.push(() => app.storage.deleteBucket());
  });

  it('sin S3_CREATE_BUCKET no crea el bucket', async () => {
    const app = await appWith(config(`boot-${randomUUID().slice(0, 8)}`, false));
    await expect(app.storage.ping()).rejects.toThrow();
  });

  it('/health/deep incluye el check storage; /health no (constitución VI)', async () => {
    const app = await appWith(config(bucket));
    const deep = HealthSchema.parse((await app.inject({ url: '/health/deep' })).json());
    expect(deep.checks.storage?.status).toBe('up');
    const shallow = HealthSchema.parse((await app.inject({ url: '/health' })).json());
    expect(shallow.checks).not.toHaveProperty('storage');
  });

  it('con el bucket caído, /health/deep informa storage down y /health sigue en 200', async () => {
    const app = await appWith({ ...config(bucket, false), endpoint: 'http://127.0.0.1:1' });
    const deep = await app.inject({ url: '/health/deep' });
    expect(deep.statusCode).toBe(503);
    expect(HealthSchema.parse(deep.json()).checks.storage?.status).toBe('down');
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
  });
});
