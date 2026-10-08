/**
 * Small image byte fixtures for sniffing tests. The GIF and WebP are complete decodable 1x1 images; the JPEG is a
 * structurally valid header with the requested size (sniffing reads headers only).
 */
export function makeGif1x1(): Buffer {
  return Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
}

export function makeWebpLossless1x1(): Buffer {
  return Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
}

/** A RIFF/WEBP container with a VP8X header for the given canvas size. */
export function makeWebpExtended(width: number, height: number): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const chunk = Buffer.concat([Buffer.from('VP8X', 'ascii'), le32(vp8x.length), vp8x]);
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), le32(4 + chunk.length), Buffer.from('WEBP', 'ascii'), chunk]);
}

export function makeJpegHeader(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

function le32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
