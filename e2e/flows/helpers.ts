import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';

export type TestUser = { name: string; email: string; password: string };

/** Datos de un usuario único por prueba: las pruebas no comparten cuentas ni estado. */
export function newUser(name = 'Ana'): TestUser {
  const id = randomUUID().slice(0, 8);
  return { name: `${name} ${id}`, email: `e2e-${id}@example.com`, password: `clave-e2e-${id}` };
}

/**
 * Registra un usuario por la API a través del proxy de web (`/api/auth/register`), para las
 * pruebas que no ejercitan el formulario de registro. Devuelve el usuario y su access token.
 */
export async function registerUser(
  request: APIRequestContext,
  user: TestUser = newUser(),
): Promise<TestUser & { accessToken: string }> {
  const response = await request.post('/api/auth/register', { data: user });
  if (!response.ok()) {
    throw new Error(`Registro fallido (${response.status()}): ${await response.text()}`);
  }
  const { accessToken } = (await response.json()) as { accessToken: string };
  return { ...user, accessToken };
}
