import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { internalFetch } from '../../src/lib/http-client';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let logLines: Array<Record<string, unknown>> = [];
const logStream = new Writable({
  write(chunk, _encoding, callback) {
    for (const line of String(chunk).split('\n').filter(Boolean)) logLines.push(JSON.parse(line));
    callback();
  },
});

// Servidor "analytics" simulado que registra las cabeceras recibidas.
let received: IncomingHttpHeaders[] = [];
let analytics: Server;
let analyticsUrl: string;
let app: FastifyInstance;

beforeAll(async () => {
  analytics = createServer((req, res) => {
    received.push(req.headers);
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
  });
  await new Promise<void>((resolve) => analytics.listen(0, '127.0.0.1', resolve));
  analyticsUrl = `http://127.0.0.1:${(analytics.address() as AddressInfo).port}`;

  app = await buildApp({ logLevel: 'info', logStream });
  app.get('/_test/outbound', async () => {
    const response = await internalFetch(`${analyticsUrl}/health`);
    return { upstream: response.status };
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await new Promise((resolve) => analytics.close(resolve));
});

beforeEach(() => {
  logLines = [];
  received = [];
});

describe('x-request-id', () => {
  it('reutiliza el identificador entrante, lo devuelve y lo registra en el log', async () => {
    const response = await app.inject({
      url: '/_test/outbound',
      headers: { 'x-request-id': 'prueba-123' },
    });
    expect(response.headers['x-request-id']).toBe('prueba-123');
    expect(logLines.some((line) => line.reqId === 'prueba-123')).toBe(true);
  });

  it('genera un UUID v7 si no llega la cabecera', async () => {
    const response = await app.inject({ url: '/_test/outbound' });
    expect(response.headers['x-request-id']).toMatch(UUID_V7);
  });

  it('ignora un identificador entrante inválido y genera uno nuevo', async () => {
    const response = await app.inject({
      url: '/_test/outbound',
      headers: { 'x-request-id': `con espacios ${'x'.repeat(80)}` },
    });
    expect(response.headers['x-request-id']).toMatch(UUID_V7);
  });

  it('reenvía el identificador en las llamadas salientes del cliente interno', async () => {
    const response = await app.inject({
      url: '/_test/outbound',
      headers: { 'x-request-id': 'prueba-456' },
    });
    expect(response.json()).toEqual({ upstream: 200 });
    expect(received).toHaveLength(1);
    expect(received[0]?.['x-request-id']).toBe('prueba-456');
  });

  it('no registra cabeceras sensibles', async () => {
    await app.inject({
      url: '/_test/outbound',
      headers: { authorization: 'Bearer s3cret-token', cookie: 'rt=s3cret-cookie' },
    });
    expect(JSON.stringify(logLines)).not.toMatch(/s3cret/);
  });
});
