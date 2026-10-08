import { describe, expect, it } from 'vitest';
import { parseRoute, stickyHash } from '../../src/shared/routes';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('window routes (INF-STKY-01)', () => {
  it('the empty hash and #/ are the main window', () => {
    for (const hash of ['', '#', '#/']) expect(parseRoute(hash)).toEqual({ kind: 'main' });
  });

  it('#/sticky/<uuid> is a sticky window for that note', () => {
    expect(parseRoute(`#/sticky/${ID}`)).toEqual({ kind: 'sticky', noteId: ID });
    expect(parseRoute(stickyHash(ID))).toEqual({ kind: 'sticky', noteId: ID });
  });

  it('anything else is invalid: upper case, extra segments, query, other paths', () => {
    for (const hash of [
      `#/sticky/${ID.toUpperCase()}`,
      `#/sticky/${ID}/x`,
      `#/sticky/${ID}?a=1`,
      '#/sticky/',
      '#/sticky/abc',
      `#sticky/${ID}`,
      '#/settings',
      `#/sticky/${ID} `,
    ]) {
      expect(parseRoute(hash), hash).toEqual({ kind: 'invalid' });
    }
  });
});
