import fs from 'node:fs';

/**
 * Where a reader takes a document's bytes from: a file path, or bytes held in memory. A locked document's bytes are
 * decrypted into memory only and never written to a file (D-185), so every check and reader takes either.
 */
export type ByteSource = string | Uint8Array;

/** All the bytes of a source. */
export function readAll(source: ByteSource): Promise<Uint8Array> {
  return typeof source === 'string' ? fs.promises.readFile(source) : Promise.resolve(source);
}
