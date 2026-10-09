import { crc32, deflateSync } from 'node:zlib';
import { prng } from './perf-fixture';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** A valid solid-color RGBA PNG. */
export function makePng(width: number, height: number, rgba: [number, number, number, number] = [106, 90, 224, 255]): Buffer {
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgba).flat())]);
  return encodePng(width, height, Buffer.concat(Array.from({ length: height }, () => row)));
}

/** An opaque RGB-noise PNG that barely compresses: decoding and painting it costs what a photo of its size costs. */
export function makeNoisePng(width: number, height: number, seed: number): Buffer {
  const rand = prng(seed);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      const px = row + 1 + x * 4;
      raw[px] = (rand() * 256) | 0;
      raw[px + 1] = (rand() * 256) | 0;
      raw[px + 2] = (rand() * 256) | 0;
      raw[px + 3] = 255;
    }
  }
  return encodePng(width, height, raw);
}

/** PNG bytes for RGBA rows that each start with filter byte 0. */
function encodePng(width: number, height: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
