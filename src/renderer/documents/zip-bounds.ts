import { unzipSync } from 'fflate';

/** What a viewer accepts of an Office package before it parses it in the renderer. */
export interface ZipBounds {
  maxFileBytes: number;
  maxEntries: number;
  maxUnpackedBytes: number;
  /** An entry above `ratioFloorBytes` may be at most this many times its compressed size. */
  maxRatio: number;
  ratioFloorBytes: number;
}

/** "tooLarge": over a bound; "unreadable": no zip, or an empty one. */
export type ZipVerdict = 'ok' | 'tooLarge' | 'unreadable';

/**
 * Whether a zip's central directory stays inside a viewer's bounds, read without unpacking anything: file size, entry
 * count, unpacked total and the compression ratio of each larger entry.
 */
export function checkZipBounds(bytes: Uint8Array, bounds: ZipBounds): ZipVerdict {
  if (bytes.length > bounds.maxFileBytes) return 'tooLarge';
  let entries = 0;
  let total = 0;
  let ok = true;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        total += file.originalSize;
        const ratio = file.size === 0 ? Infinity : file.originalSize / file.size;
        if (entries > bounds.maxEntries || total > bounds.maxUnpackedBytes) ok = false;
        if (file.originalSize > bounds.ratioFloorBytes && ratio > bounds.maxRatio) ok = false;
        return false;
      },
    });
  } catch {
    return 'unreadable';
  }
  if (entries === 0) return 'unreadable';
  return ok ? 'ok' : 'tooLarge';
}
