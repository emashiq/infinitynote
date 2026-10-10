import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { checkZipBounds, type ZipBounds } from '../../../src/renderer/documents/zip-bounds';

const BOUNDS: ZipBounds = { maxFileBytes: 64 * 1024, maxEntries: 3, maxUnpackedBytes: 32 * 1024, maxRatio: 10, ratioFloorBytes: 4 * 1024 };

/** Bytes that do not compress, so only their size counts. */
const noise = (n: number) => Uint8Array.from({ length: n }, (_, i) => (Math.imul(i + 1, 2654435761) >>> 24) & 0xff);

describe('zip bounds of the Office viewers (D-153, D-178)', () => {
  it('accepts a package inside every bound', () => {
    expect(checkZipBounds(zipSync({ 'a.xml': noise(1000), 'b.xml': noise(1000) }), BOUNDS)).toBe('ok');
  });

  it('refuses too many entries, too much unpacked, a compression ratio of a bomb, and a file over the size', () => {
    expect(checkZipBounds(zipSync({ a: noise(10), b: noise(10), c: noise(10), d: noise(10) }), BOUNDS)).toBe('tooLarge');
    expect(checkZipBounds(zipSync({ a: noise(20 * 1024), b: noise(20 * 1024) }, { level: 0 }), BOUNDS)).toBe('tooLarge');
    // 8 KiB of zeros packs to a few bytes: over the ratio once the entry is above the floor.
    expect(checkZipBounds(zipSync({ fill: new Uint8Array(8 * 1024) }), BOUNDS)).toBe('tooLarge');
    expect(checkZipBounds(zipSync({ fill: new Uint8Array(2 * 1024) }), BOUNDS)).toBe('ok');
    expect(checkZipBounds(zipSync({ a: noise(70 * 1024) }, { level: 0 }), { ...BOUNDS, maxUnpackedBytes: 1024 * 1024 })).toBe('tooLarge');
  });

  it('calls bytes that are no zip, and an empty zip, unreadable', () => {
    expect(checkZipBounds(new TextEncoder().encode('not a zip at all'), BOUNDS)).toBe('unreadable');
    expect(checkZipBounds(zipSync({}), BOUNDS)).toBe('unreadable');
  });
});
