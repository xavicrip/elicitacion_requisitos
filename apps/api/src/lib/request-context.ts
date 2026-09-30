import { AsyncLocalStorage } from 'node:async_hooks';

/** `userId` se añade al autenticar la petición (plugin `auth`). */
type RequestContext = { requestId: string; userId?: string };

const storage = new AsyncLocalStorage<RequestContext>();

/** Ejecuta `fn` con el contexto de la petición en curso (lo usa el plugin de observabilidad). */
export function runWithRequestContext(context: RequestContext, fn: () => void): void {
  storage.run(context, fn);
}

/** Identificador de la petición en curso, si la hay. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Usuario autenticado de la petición en curso, si lo hay. */
export function currentUserId(): string | undefined {
  return storage.getStore()?.userId;
}

/** Asocia el usuario autenticado a la petición en curso. */
export function setCurrentUserId(userId: string): void {
  const store = storage.getStore();
  if (store) store.userId = userId;
}
