import { AsyncLocalStorage } from 'node:async_hooks';

type RequestContext = { requestId: string };

const storage = new AsyncLocalStorage<RequestContext>();

/** Ejecuta `fn` con el contexto de la petición en curso (lo usa el plugin de observabilidad). */
export function runWithRequestContext(context: RequestContext, fn: () => void): void {
  storage.run(context, fn);
}

/** Identificador de la petición en curso, si la hay. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
