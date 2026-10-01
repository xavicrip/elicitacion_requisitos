import { HttpError } from './errors.js';

/** `ETag` de un recurso con concurrencia optimista: su `rev` entre comillas. */
export const revEtag = (rev: number) => `"${rev}"`;

/**
 * Lee el `rev` de `If-Match` (`"3"`, `W/"3"` o `3`). Sin él, o si no es un entero, `428`:
 * sin `If-Match` no se puede saber si se pisaría el cambio de otra persona.
 */
export function parseIfMatch(header: string | undefined, resource: string): number {
  const rev = header
    ?.trim()
    .replace(/^W\//, '')
    .replace(/^"(.*)"$/, '$1');
  if (!rev || !/^\d+$/.test(rev)) {
    throw new HttpError(
      428,
      'PRECONDITION_REQUIRED',
      `Falta la versión de ${resource} (If-Match). Recarga la página e inténtalo de nuevo.`,
    );
  }
  return Number(rev);
}
