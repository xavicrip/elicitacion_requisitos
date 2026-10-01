import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/lib/errors';
import { parseIfMatch, revEtag } from '../../src/lib/if-match';

describe('If-Match / ETag con el rev (concurrencia optimista)', () => {
  it('el ETag es el rev entre comillas', () => {
    expect(revEtag(3)).toBe('"3"');
  });

  it.each([
    ['"3"', 3],
    ['W/"3"', 3],
    ['3', 3],
    [' "12" ', 12],
  ])('If-Match %s → rev %i', (header, rev) => {
    expect(parseIfMatch(header, 'el detalle')).toBe(rev);
  });

  it.each([undefined, '', '"abc"', '*', '"-1"'])(
    'If-Match %s → 428 que nombra el recurso',
    (header) => {
      const error = (() => {
        try {
          parseIfMatch(header, 'el detalle');
        } catch (caught) {
          return caught;
        }
      })();
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ statusCode: 428, code: 'PRECONDITION_REQUIRED' });
      expect((error as Error).message).toContain('el detalle');
    },
  );
});
