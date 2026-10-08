#!/usr/bin/env node
// Deterministic placeholder icon generator: resources/icon.png (512x512 RGBA) and resources/icon.ico
// (PNG-compressed entries 256, 48, 32, 16). Dependency-free; running it twice yields identical bytes.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { repoRoot } from './lib/proc.mjs';

const ACCENT = [0x6a, 0x5a, 0xe0];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Rounded square (accent) with a white lemniscate stroke, antialiased by signed distance. */
function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const margin = size * 0.0625;
  const half = size / 2 - margin;
  const radius = size * 0.22;
  // Stroke mask by stamping discs along the curve.
  const mask = new Float32Array(size * size);
  const a = size * 0.3;
  const strokeR = Math.max(0.9, size * 0.045);
  const steps = 6000;
  for (let i = 0; i < steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const d = 1 + Math.sin(t) ** 2;
    const cx = size / 2 + (a * Math.cos(t)) / d * 1.0;
    const cy = size / 2 + (a * Math.sin(t) * Math.cos(t)) / d * 1.6;
    const x0 = Math.max(0, Math.floor(cx - strokeR - 1));
    const x1 = Math.min(size - 1, Math.ceil(cx + strokeR + 1));
    const y0 = Math.max(0, Math.floor(cy - strokeR - 1));
    const y1 = Math.min(size - 1, Math.ceil(cy + strokeR + 1));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const cov = clamp01(strokeR + 0.5 - dist);
        const idx = y * size + x;
        if (cov > mask[idx]) mask[idx] = cov;
      }
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const qx = Math.abs(x + 0.5 - size / 2) - (half - radius);
      const qy = Math.abs(y + 0.5 - size / 2) - (half - radius);
      const sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
      const alpha = clamp01(0.5 - sdf);
      const m = mask[y * size + x];
      const o = (y * size + x) * 4;
      px[o] = Math.round(ACCENT[0] * (1 - m) + 255 * m);
      px[o + 1] = Math.round(ACCENT[1] * (1 - m) + 255 * m);
      px[o + 2] = Math.round(ACCENT[2] * (1 - m) + 255 * m);
      px[o + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

function encodeIco(sizes) {
  const images = sizes.map((s) => ({ size: s, png: encodePng(s, render(s)) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const outDir = path.join(repoRoot, 'resources');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), encodePng(512, render(512)));
fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeIco([256, 48, 32, 16]));
console.log('wrote resources/icon.png and resources/icon.ico');
