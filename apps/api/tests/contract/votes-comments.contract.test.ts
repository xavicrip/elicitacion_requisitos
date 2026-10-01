import { CommentSchema, VoteStateSchema } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { createDetail, publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser } from '../helpers/users';

// Contrato: votos (PUT/DELETE /details/{id}/vote) y comentarios.
const ErrorSchema = z.object({ code: z.string(), message: z.string() });

let app: FastifyInstance;
let author: Record<string, string>;
let voter: Record<string, string>;
let detailId: string;

beforeAll(async () => {
  ({ app } = await buildTestApp('votescontract', { withAuth: true }));
  await app.ready();
  const ana = await registerTestUser(app, 'Ana');
  const luis = await registerTestUser(app, 'Luis');
  author = authHeaders(ana);
  voter = authHeaders(luis);
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
    ],
  });
  const diagram = await publishedDiagram(app, author, projectId);
  detailId = (
    await createDetail(app, author, diagram.diagramId, diagram.keys['Validar pago']!)
  ).json().id;
});

afterAll(() => closeTestApp(app));

describe('/details/{detailId}/vote', () => {
  it('PUT 200 y DELETE 200 devuelven el estado del voto', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/details/${detailId}/vote`,
      headers: voter,
    });
    expect(put.statusCode).toBe(200);
    expect(VoteStateSchema.strict().parse(put.json())).toEqual({ voteCount: 1, votedByMe: true });
    const del = await app.inject({
      method: 'DELETE',
      url: `/details/${detailId}/vote`,
      headers: voter,
    });
    expect(VoteStateSchema.strict().parse(del.json())).toEqual({ voteCount: 0, votedByMe: false });
  });

  it('PUT 403 con el formato de error al votar el detalle propio', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/details/${detailId}/vote`,
      headers: author,
    });
    expect(response.statusCode).toBe(403);
    ErrorSchema.parse(response.json());
  });
});

describe('/details/{detailId}/comments y /comments/{commentId}', () => {
  it('POST 201, GET 200, PATCH 200 y DELETE 204', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/details/${detailId}/comments`,
      headers: voter,
      payload: { text: '¿Aplica también a PayPal?' },
    });
    expect(created.statusCode).toBe(201);
    const comment = CommentSchema.strict().parse(created.json());

    const list = await app.inject({ url: `/details/${detailId}/comments`, headers: author });
    expect(list.statusCode).toBe(200);
    z.array(CommentSchema.strict()).length(1).parse(list.json());

    const edited = await app.inject({
      method: 'PATCH',
      url: `/comments/${comment.id}`,
      headers: voter,
      payload: { text: '¿Aplica a PayPal y a Bizum?' },
    });
    expect(edited.statusCode).toBe(200);
    expect(CommentSchema.strict().parse(edited.json()).editedAt).toEqual(expect.any(String));

    const removed = await app.inject({
      method: 'DELETE',
      url: `/comments/${comment.id}`,
      headers: voter,
    });
    expect(removed.statusCode).toBe(204);
  });
});
