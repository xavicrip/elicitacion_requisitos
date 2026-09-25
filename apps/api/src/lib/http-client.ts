import { currentRequestId } from './request-context.js';

export const REQUEST_ID_HEADER = 'x-request-id';

type InternalFetchInit = RequestInit & { timeoutMs?: number };

/**
 * `fetch` para llamadas entre servicios: reenvía automáticamente el `x-request-id` de la
 * petición en curso (FR-004) y aplica un timeout (5 s por defecto).
 */
export async function internalFetch(url: string, init: InternalFetchInit = {}): Promise<Response> {
  const { timeoutMs = 5000, headers, ...rest } = init;
  const merged = new Headers(headers);
  const requestId = currentRequestId();
  if (requestId && !merged.has(REQUEST_ID_HEADER)) merged.set(REQUEST_ID_HEADER, requestId);
  return fetch(url, {
    ...rest,
    headers: merged,
    signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
  });
}
