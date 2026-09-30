import { randomInt } from 'node:crypto';
import { test as base } from '@playwright/test';

/**
 * `test` de los E2E de `flows`: cada prueba envía su propia `X-Real-IP` (Caddy la reenvía
 * cuando no hay borde de Railway), así que el rate limit de /auth (20 peticiones por minuto e
 * IP) y el bloqueo por origen no se comparten entre pruebas.
 */
export const test = base.extend<{ clientIp: string }>({
  // Playwright exige desestructurar el primer argumento, aunque este fixture no use ninguno.
  // eslint-disable-next-line no-empty-pattern
  clientIp: async ({}, use) => {
    await use(`198.18.${randomInt(256)}.${randomInt(1, 255)}`);
  },
  extraHTTPHeaders: async ({ clientIp }, use) => {
    await use({ 'x-real-ip': clientIp });
  },
});

export { expect } from '@playwright/test';
