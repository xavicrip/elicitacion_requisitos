import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export type TestUser = { id: string; name: string; email: string; accessToken: string };

/** Registra un usuario único por la API (requiere `buildTestApp(…, { withAuth: true })`). */
export async function registerTestUser(app: FastifyInstance, name = 'Ana'): Promise<TestUser> {
  const suffix = randomUUID().slice(0, 8);
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    // IP propia: el rate limit de /auth no se comparte entre usuarios de prueba.
    headers: {
      'x-real-ip': `10.${suffix.charCodeAt(0)}.${suffix.charCodeAt(1)}.${suffix.charCodeAt(2)}`,
    },
    payload: {
      name: `${name} ${suffix}`,
      email: `${suffix}@example.com`,
      password: 'una-frase-larga',
    },
  });
  if (response.statusCode !== 201) throw new Error(`Registro fallido: ${response.body}`);
  const { accessToken, user } = response.json();
  return { ...user, accessToken };
}

export const authHeaders = (user: TestUser) => ({ authorization: `Bearer ${user.accessToken}` });
