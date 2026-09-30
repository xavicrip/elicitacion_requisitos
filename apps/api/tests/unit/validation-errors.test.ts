import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../../src/app';
import { HttpError } from '../../src/lib/errors';

let app: FastifyInstance;
const logs: string[] = [];

beforeAll(async () => {
  app = await buildApp({
    logLevel: 'error',
    logStream: new Writable({
      write(chunk, _encoding, done) {
        logs.push(String(chunk));
        done();
      },
    }),
  });
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.post(
    '/eco',
    {
      schema: {
        body: z.object({
          name: z.string().min(1).max(5),
          nested: z.object({ email: z.email() }).optional(),
        }),
        response: { 200: z.object({ name: z.string() }) },
      },
    },
    async (request) => ({ name: request.body.name, extra: 'se descarta' }),
  );
  routes.get('/conflicto', async () => {
    throw new HttpError(409, 'LAST_ADMIN', 'El proyecto necesita al menos un Administrador');
  });
  routes.get('/roto', async () => {
    throw new Error('detalle interno s3cret');
  });
  await app.ready();
});

afterAll(() => app.close());

describe('validación con zod y formato de error del contrato', () => {
  it('valida el cuerpo y serializa solo los campos de la respuesta', async () => {
    const response = await app.inject({ method: 'POST', url: '/eco', payload: { name: 'Ana' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: 'Ana' });
  });

  it('un cuerpo inválido responde 400 con los campos y mensajes en español', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/eco',
      payload: { name: 'demasiado largo', nested: { email: 'no' } },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toMatchObject({ code: 'VALIDATION_ERROR', message: expect.any(String) });
    expect(Object.keys(body.fields).sort()).toEqual(['name', 'nested.email']);
    expect(body.message).toMatch(/revisa/i);
    // Mensajes de zod traducidos (locale `es`).
    expect(body.fields.name).toMatch(/demasiado grande|como máximo|caracteres/i);
  });

  it('un HttpError responde con su estado, código y mensaje', async () => {
    const response = await app.inject({ method: 'GET', url: '/conflicto' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 'LAST_ADMIN',
      message: 'El proyecto necesita al menos un Administrador',
    });
  });

  it('un error inesperado responde 500 genérico y el detalle solo va al log', async () => {
    const response = await app.inject({ method: 'GET', url: '/roto' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Ha ocurrido un error inesperado. Inténtalo de nuevo más tarde.',
    });
    expect(response.body).not.toMatch(/s3cret/);
    expect(logs.join('')).toMatch(/detalle interno/);
  });

  it('una ruta inexistente responde 404 con el formato del contrato', async () => {
    const response = await app.inject({ method: 'GET', url: '/no-existe' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'NOT_FOUND', message: 'Recurso no encontrado' });
  });

  it('un JSON mal formado responde 400 con el formato del contrato', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/eco',
      headers: { 'content-type': 'application/json' },
      payload: '{"name":',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'BAD_REQUEST' });
  });
});
