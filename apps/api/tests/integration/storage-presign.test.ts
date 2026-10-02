import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorage } from '../../src/lib/storage';
import { S3_TEST_CREDENTIALS, S3_TEST_URL } from '../helpers/services';

// Plan de la 006, ajuste 4: el worker de detección descarga la imagen display por una URL
// firmada de corta duración, sin credenciales del bucket. Plan de la 007, ajuste 1: el worker de
// minería sube sus resultados por una URL firmada de escritura.

const storage = createStorage({
  endpoint: S3_TEST_URL,
  bucket: `presign-${randomUUID().slice(0, 8)}`,
  region: 'us-east-1',
  forcePathStyle: true,
  createBucket: true,
  ...S3_TEST_CREDENTIALS,
});

beforeAll(async () => {
  await storage.ensureBucket();
  await storage.put('v1/display.webp', Buffer.from('imagen'), 'image/webp');
});
afterAll(async () => {
  await storage.deletePrefix('');
  await storage.deleteBucket();
  storage.destroy();
});

describe('presignGet', () => {
  it('descarga el objeto sin credenciales', async () => {
    const url = await storage.presignGet('v1/display.webp', 600);
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Expires=600');
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('imagen');
  });

  it('caduca pasado el TTL', async () => {
    const url = await storage.presignGet('v1/display.webp', 1);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect((await fetch(url)).status).toBe(403);
  });

  it('no permite escribir con la URL de lectura', async () => {
    const url = await storage.presignGet('v1/display.webp', 600);
    const response = await fetch(url, { method: 'PUT', body: 'otra cosa' });
    expect(response.status).toBe(403);
    expect(await (await fetch(url)).text()).toBe('imagen');
  });
});

describe('presignPut', () => {
  const read = async (key: string) => {
    const object = await storage.getStream(key);
    if (!object) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.from(chunk as Uint8Array));
    return { text: Buffer.concat(chunks).toString(), contentType: object.contentType };
  };

  it('sube el objeto sin credenciales con el content-type fijado', async () => {
    const url = await storage.presignPut('run/results.json.gz', 'application/gzip', 900);
    expect(url).toContain('X-Amz-Signature=');
    const response = await fetch(url, {
      method: 'PUT',
      body: 'resultados',
      headers: { 'content-type': 'application/gzip' },
    });
    expect(response.status).toBe(200);
    expect(await read('run/results.json.gz')).toEqual({
      text: 'resultados',
      contentType: 'application/gzip',
    });
  });

  it('caduca pasado el TTL', async () => {
    const url = await storage.presignPut('run/late.json.gz', 'application/gzip', 1);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const response = await fetch(url, {
      method: 'PUT',
      body: 'tarde',
      headers: { 'content-type': 'application/gzip' },
    });
    expect(response.status).toBe(403);
    expect(await read('run/late.json.gz')).toBeNull();
  });

  it('no sirve para leer ni para otra clave', async () => {
    const url = await storage.presignPut('run/only.json.gz', 'application/gzip', 900);
    expect((await fetch(url)).status).toBe(403);
    const other = url.replace('run/only.json.gz', 'run/other.json.gz');
    const response = await fetch(other, {
      method: 'PUT',
      body: 'x',
      headers: { 'content-type': 'application/gzip' },
    });
    expect(response.status).toBe(403);
    expect(await read('run/other.json.gz')).toBeNull();
  });
});
