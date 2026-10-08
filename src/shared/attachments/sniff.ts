import { MAX_PIXELS } from './limits';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export type SniffResult =
  | { ok: true; mime: ImageMime; ext: 'png' | 'jpg' | 'gif' | 'webp'; width: number; height: number }
  | { ok: false; reason: 'unsupported' | 'truncated' | 'tooManyPixels' };

type Dimensions = { width: number; height: number } | 'truncated';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// The IEND chunk type and its fixed CRC; every complete PNG ends with it.
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
const TAIL_WINDOW = 1024;

function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0): boolean {
  if (bytes.length < at + prefix.length) return false;
  return prefix.every((b, i) => bytes[at + i] === b);
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function containsNearEnd(bytes: Uint8Array, needle: readonly number[]): boolean {
  for (let i = bytes.length - needle.length; i >= Math.max(0, bytes.length - TAIL_WINDOW); i -= 1) {
    if (startsWith(bytes, needle, i)) return true;
  }
  return false;
}

function pngSize(b: Uint8Array, view: DataView): Dimensions {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR' || !containsNearEnd(b, PNG_IEND)) return 'truncated';
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegSize(b: Uint8Array, view: DataView): Dimensions {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return 'truncated';
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return 'truncated'; // end of image or scan data before any frame header
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2; // markers without a length
      continue;
    }
    const length = view.getUint16(i + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 9 > b.length) return 'truncated';
      return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
    }
    i += 2 + length;
  }
  return 'truncated';
}

function gifSize(b: Uint8Array, view: DataView): Dimensions {
  if (b.length < 14 || !containsNearEnd(b, [0x3b])) return 'truncated';
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function webpSize(b: Uint8Array, view: DataView): Dimensions {
  if (b.length < 30 || view.getUint32(4, true) + 8 > b.length) return 'truncated';
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8X') {
    const w = b[24]! | (b[25]! << 8) | (b[26]! << 16);
    const h = b[27]! | (b[28]! << 8) | (b[29]! << 16);
    return { width: w + 1, height: h + 1 };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return { width: 0, height: 0 };
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') {
    if (!startsWith(b, [0x9d, 0x01, 0x2a], 23)) return { width: 0, height: 0 };
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  return { width: 0, height: 0 };
}

/**
 * Identifies PNG, JPEG, GIF and WebP from their magic numbers and reads the pixel size from the header. The
 * declared file type is never trusted; anything else (SVG, HTML, HEIC, unknown) is unsupported (D-054).
 */
export function sniffImage(bytes: Uint8Array): SniffResult {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let kind: { mime: ImageMime; ext: 'png' | 'jpg' | 'gif' | 'webp'; size: (b: Uint8Array, v: DataView) => Dimensions } | null = null;
  if (startsWith(bytes, PNG_SIGNATURE)) kind = { mime: 'image/png', ext: 'png', size: pngSize };
  else if (startsWith(bytes, [0xff, 0xd8, 0xff])) kind = { mime: 'image/jpeg', ext: 'jpg', size: jpegSize };
  else if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) kind = { mime: 'image/gif', ext: 'gif', size: gifSize };
  else if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') kind = { mime: 'image/webp', ext: 'webp', size: webpSize };
  if (!kind) return { ok: false, reason: 'unsupported' };

  const size = kind.size(bytes, view);
  if (size === 'truncated') return { ok: false, reason: 'truncated' };
  if (size.width < 1 || size.height < 1) return { ok: false, reason: 'unsupported' };
  if (size.width * size.height > MAX_PIXELS) return { ok: false, reason: 'tooManyPixels' };
  return { ok: true, mime: kind.mime, ext: kind.ext, width: size.width, height: size.height };
}
