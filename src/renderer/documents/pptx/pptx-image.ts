import { MAX_SLIDE_IMAGE_BYTES } from '../../../shared/documents/presentation';

/** A picture that can go on a slide: PNG or JPEG (what the library writes), with its size in pixels. */
export interface SlideImage {
  type: 'png' | 'jpeg';
  width: number;
  height: number;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_SIDE = 65_535;

const uint16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const uint32 = (b: Uint8Array, at: number) => ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;

function pngSize(b: Uint8Array): [number, number] | null {
  // The IHDR chunk comes first: length, type, width, height.
  if (b.length < 24 || String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!) !== 'IHDR') return null;
  return [uint32(b, 16), uint32(b, 20)];
}

function jpegSize(b: Uint8Array): [number, number] | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1]!;
    // Start-of-frame markers (baseline, progressive, …) carry the size; DHT, JPG and DAC are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [uint16(b, at + 7), uint16(b, at + 5)];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    at += 2 + uint16(b, at + 2);
  }
  return null;
}

/** The picture in these bytes, or null when they are not a PNG or JPEG of a usable size within the limit. */
export function slideImage(bytes: Uint8Array): SlideImage | null {
  if (bytes.length === 0 || bytes.length > MAX_SLIDE_IMAGE_BYTES) return null;
  const type = PNG_SIGNATURE.every((v, i) => bytes[i] === v) ? 'png' : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpeg' : null;
  if (!type) return null;
  const size = type === 'png' ? pngSize(bytes) : jpegSize(bytes);
  if (!size) return null;
  const [width, height] = size;
  return width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE ? { type, width, height } : null;
}
