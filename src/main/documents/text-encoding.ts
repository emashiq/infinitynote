/** Byte-order marks of the Unicode encodings a CSV or HTML file may start with. */
const BOMS: ReadonlyArray<{ bytes: readonly number[]; label: 'utf-8' | 'utf-16le' | 'utf-16be' }> = [
  { bytes: [0xef, 0xbb, 0xbf], label: 'utf-8' },
  { bytes: [0xff, 0xfe], label: 'utf-16le' },
  { bytes: [0xfe, 0xff], label: 'utf-16be' },
];

/** The encoding a byte-order mark names, or null without one. */
export function bomEncoding(bytes: Uint8Array): 'utf-8' | 'utf-16le' | 'utf-16be' | null {
  return BOMS.find((b) => b.bytes.every((v, i) => bytes[i] === v))?.label ?? null;
}

/** Whether a sample of a file reads as text: a Unicode byte-order mark, or no NUL byte. */
export function looksLikeText(sample: Uint8Array): boolean {
  return bomEncoding(sample) !== null || !sample.includes(0);
}

/** Whether the bytes are valid UTF-8; in a sample cut from a longer file, a character cut off at its end counts as valid. */
export function isUtf8(bytes: Uint8Array, cutFromLonger = false): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: cutFromLonger });
    return true;
  } catch {
    return false;
  }
}

/** Decodes a text file (or its start): by its byte-order mark, else as UTF-8 when it is valid UTF-8, else as Windows-1252. */
export function decodeText(bytes: Uint8Array, cutFromLonger = false): string {
  const label = bomEncoding(bytes) ?? (isUtf8(bytes, cutFromLonger) ? 'utf-8' : 'windows-1252');
  return new TextDecoder(label).decode(bytes);
}
