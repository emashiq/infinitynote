import { describe, expect, it } from 'vitest';
import { sniffImage } from '../../src/shared/attachments/sniff';
import { makeGif1x1, makeJpegHeader, makeWebpExtended, makeWebpLossless1x1 } from '../support/images';
import { makePng } from '../support/png';

describe('sniffImage (INF-EDIT-10)', () => {
  it('reads PNG, JPEG, GIF and WebP types and dimensions from the bytes', () => {
    expect(sniffImage(makePng(64, 48))).toEqual({ ok: true, mime: 'image/png', ext: 'png', width: 64, height: 48 });
    expect(sniffImage(makeJpegHeader(640, 480))).toEqual({ ok: true, mime: 'image/jpeg', ext: 'jpg', width: 640, height: 480 });
    expect(sniffImage(makeGif1x1())).toEqual({ ok: true, mime: 'image/gif', ext: 'gif', width: 1, height: 1 });
    expect(sniffImage(makeWebpLossless1x1())).toEqual({ ok: true, mime: 'image/webp', ext: 'webp', width: 1, height: 1 });
    expect(sniffImage(makeWebpExtended(300, 200))).toEqual({ ok: true, mime: 'image/webp', ext: 'webp', width: 300, height: 200 });
  });

  it('works on a view into a larger buffer', () => {
    const png = makePng(3, 2);
    const padded = new Uint8Array(png.length + 10);
    padded.set(png, 5);
    expect(sniffImage(padded.subarray(5, 5 + png.length))).toMatchObject({ ok: true, width: 3, height: 2 });
  });

  it('rejects SVG, HTML, HEIC, text and empty input as unsupported', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sniffImage(enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toEqual({ ok: false, reason: 'unsupported' });
    expect(sniffImage(enc('<!doctype html><img src=x onerror=alert(1)>'))).toEqual({ ok: false, reason: 'unsupported' });
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'ascii'), Buffer.alloc(16)]);
    expect(sniffImage(heic)).toEqual({ ok: false, reason: 'unsupported' });
    expect(sniffImage(new Uint8Array())).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('detects truncated images', () => {
    const png = makePng(10, 10);
    expect(sniffImage(png.subarray(0, png.length - 20))).toEqual({ ok: false, reason: 'truncated' });
    expect(sniffImage(png.subarray(0, 20))).toEqual({ ok: false, reason: 'truncated' });
    expect(sniffImage(makeJpegHeader(10, 10).subarray(0, 12))).toEqual({ ok: false, reason: 'truncated' });
    const gif = makeGif1x1();
    expect(sniffImage(gif.subarray(0, 12))).toEqual({ ok: false, reason: 'truncated' });
    const webp = makeWebpLossless1x1();
    expect(sniffImage(webp.subarray(0, webp.length - 4))).toEqual({ ok: false, reason: 'truncated' });
  });

  it('rejects images over 100 megapixels from the header alone', () => {
    const header = makePng(1, 1);
    header.writeUInt32BE(12000, 16);
    header.writeUInt32BE(12000, 20);
    expect(sniffImage(header)).toEqual({ ok: false, reason: 'tooManyPixels' });
    expect(sniffImage(makeWebpExtended(10000, 10000))).toMatchObject({ ok: true });
    expect(sniffImage(makeWebpExtended(10001, 10000))).toEqual({ ok: false, reason: 'tooManyPixels' });
  });

  it('rejects zero dimensions', () => {
    const header = makePng(1, 1);
    header.writeUInt32BE(0, 16);
    expect(sniffImage(header)).toEqual({ ok: false, reason: 'unsupported' });
  });
});
