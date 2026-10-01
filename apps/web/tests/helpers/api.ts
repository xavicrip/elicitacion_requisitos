import { vi } from 'vitest';

export type Handler = (body: unknown) => Response | Promise<Response>;
export type Recorded = {
  url: string;
  method: string;
  body?: unknown;
  auth: string | null;
  ifMatch: string | null;
};

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * API simulada con `fetch`: responde según "MÉTODO /api/ruta". Un handler puede ser un array
 * para responder en orden a llamadas sucesivas. Por defecto, sin flags.
 */
export function mockApi(initial: Record<string, Handler | Handler[]> = {}) {
  const handlers: Record<string, Handler | Handler[]> = {
    'GET /api/config': () => json(200, { flags: {} }),
    ...initial,
  };
  const requests: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      const headers = new Headers(init.headers);
      requests.push({
        url,
        method,
        body,
        auth: headers.get('authorization'),
        ifMatch: headers.get('if-match'),
      });
      const entry = handlers[`${method} ${url}`];
      const handler = Array.isArray(entry) ? entry.shift() : entry;
      return handler ? handler(body) : json(404, { code: 'NOT_FOUND', message: 'No encontrado' });
    }),
  );
  return { handlers, requests };
}
