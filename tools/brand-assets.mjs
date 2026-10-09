#!/usr/bin/env node
// Builds every app and website brand image from the user's logo, resources/brand/logo-source.png.
//
//   node tools/brand-assets.mjs        icons and logos (pure Node, byte-for-byte deterministic)
//   node tools/brand-assets.mjs --og   also renders website/assets/og-image.png with Electron offscreen
//
// The source is an AI-generated RGBA image whose background removal left faint dust (mostly alpha 1-3)
// around the artwork. Cleaning keeps only the large connected shapes and their antialiased rim, trims
// to the content and centers it on a square canvas; every size is then Lanczos-filtered down from that master.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(repoRoot, 'resources', 'brand', 'logo-source.png');

/** Pixels at or above this alpha form the shapes; fainter pixels survive only as the rim of a kept shape. */
const CORE_ALPHA = 16;
/** Pixels fainter than this are invisible on any background and are always cleared. */
const MIN_ALPHA = 4;
/** A shape is kept when its core area is at least this fraction of the largest shape. */
const MIN_SHAPE_FRACTION = 0.01;
/** Width of the antialiased rim (in source pixels) kept around the core of a kept shape. */
const RIM_PX = 2;
/** Empty margin on each side of the longer content axis, as a fraction of the square side. */
const PADDING = 0.03;

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512];
const LOGO_SIZES = [32, 64, 128, 256];
const TRAY_SIZES = [16, 24, 32];
const FAVICON_SIZES = [16, 32, 48];

// ---------------------------------------------------------------------------------------------- PNG

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Predictor of PNG filter `type` for byte `x` of a row, given the reconstructed current and previous rows. */
function predict(type, cur, prev, x) {
  const a = x >= 4 ? cur[x - 4] : 0;
  const b = prev[x];
  const c = x >= 4 ? prev[x - 4] : 0;
  switch (type) {
    case 1:
      return a;
    case 2:
      return b;
    case 3:
      return (a + b) >> 1;
    case 4:
      return paeth(a, b, c);
    default:
      return 0;
  }
}

/** Decodes an 8-bit RGBA, non-interlaced PNG (the only kind the brand source is) to straight RGBA. */
function decodePng(file) {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${file}: not a PNG`);
  let width = 0;
  let height = 0;
  const idat = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, colorType, , , interlace] = data.subarray(8);
      if (depth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(`${file}: expected 8-bit RGBA without interlacing`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  const zero = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y ? rgba.subarray((y - 1) * stride, y * stride) : zero;
    for (let x = 0; x < stride; x += 1) cur[x] = (line[x] + predict(filter, cur, prev, x)) & 0xff;
  }
  return { width, height, rgba };
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encodes straight RGBA as an 8-bit RGBA PNG, choosing per row the filter with the smallest residuals. */
function encodePng({ width, height, rgba }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const out = Buffer.alloc((stride + 1) * height);
  const zero = Buffer.alloc(stride);
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const cur = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y ? rgba.subarray((y - 1) * stride, y * stride) : zero;
    let bestCost = Infinity;
    for (let type = 0; type <= 4; type += 1) {
      let cost = 0;
      for (let x = 0; x < stride; x += 1) {
        const v = (cur[x] - predict(type, cur, prev, x)) & 0xff;
        candidate[x] = v;
        cost += v < 128 ? v : 256 - v;
      }
      if (cost < bestCost) {
        bestCost = cost;
        out[y * (stride + 1)] = type;
        candidate.copy(out, y * (stride + 1) + 1);
      }
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(out, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// -------------------------------------------------------------------------------------------- Clean

/** Labels 8-connected regions of `inside` pixels; returns the label per pixel (-1 outside) and region areas. */
function labelRegions(width, height, inside) {
  const labels = new Int32Array(width * height).fill(-1);
  const areas = [];
  const stack = [];
  for (let start = 0; start < labels.length; start += 1) {
    if (!inside[start] || labels[start] >= 0) continue;
    const id = areas.length;
    let area = 0;
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      area += 1;
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (inside[j] && labels[j] < 0) {
            labels[j] = id;
            stack.push(j);
          }
        }
      }
    }
    areas.push(area);
  }
  return { labels, areas };
}

/** Square dilation of a 0/1 mask by `radius` pixels (separable max filter). */
function dilate(width, height, mask, radius) {
  const rows = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius) && !on; k += 1) {
        on = mask[y * width + k];
      }
      rows[y * width + x] = on;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius) && !on; k += 1) {
        on = rows[k * width + x];
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

/** Removes background dust: keeps large shapes plus their faint rim, clears everything else to (0,0,0,0). */
function removeDust({ width, height, rgba }) {
  const count = width * height;
  const core = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) core[i] = rgba[i * 4 + 3] >= CORE_ALPHA ? 1 : 0;
  const { labels, areas } = labelRegions(width, height, core);
  const minArea = Math.max(...areas) * MIN_SHAPE_FRACTION;
  const kept = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) kept[i] = labels[i] >= 0 && areas[labels[i]] >= minArea ? 1 : 0;
  const keep = dilate(width, height, kept, RIM_PX);
  const out = Buffer.alloc(rgba.length);
  let cleared = 0;
  for (let i = 0; i < count; i += 1) {
    const alpha = rgba[i * 4 + 3];
    if (keep[i] && alpha >= MIN_ALPHA) rgba.copy(out, i * 4, i * 4, i * 4 + 4);
    else if (alpha) cleared += 1;
  }
  const dropped = areas.filter((a) => a < minArea).length;
  return { image: { width, height, rgba: out }, cleared, dropped };
}

/** Crops to the visible content and centers it on a transparent square with PADDING on the longer axis. */
function squareToContent({ width, height, rgba }) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!rgba[(y * width + x) * 4 + 3]) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) throw new Error('the logo is fully transparent');
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const side = Math.ceil(Math.max(cw, ch) / (1 - 2 * PADDING));
  const ox = Math.floor((side - cw) / 2);
  const oy = Math.floor((side - ch) / 2);
  const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < ch; y += 1) {
    rgba.copy(out, ((oy + y) * side + ox) * 4, ((y0 + y) * width + x0) * 4, ((y0 + y) * width + x1 + 1) * 4);
  }
  return { width: side, height: side, rgba: out, content: { width: cw, height: ch } };
}

// ------------------------------------------------------------------------------------------- Resize

const LANCZOS_LOBES = 3;

function lanczos(x) {
  if (x === 0) return 1;
  if (Math.abs(x) >= LANCZOS_LOBES) return 0;
  const px = Math.PI * x;
  return (LANCZOS_LOBES * Math.sin(px) * Math.sin(px / LANCZOS_LOBES)) / (px * px);
}

/** Per output index, the source indices and normalized weights of a Lanczos-3 downscale. */
function lanczosWeights(srcSize, dstSize) {
  const scale = srcSize / dstSize;
  const support = LANCZOS_LOBES * scale;
  const taps = [];
  for (let d = 0; d < dstSize; d += 1) {
    const center = (d + 0.5) * scale;
    const list = [];
    let total = 0;
    for (let s = Math.floor(center - support); s <= Math.ceil(center + support); s += 1) {
      const w = lanczos((s + 0.5 - center) / scale);
      if (!w) continue;
      list.push([Math.min(srcSize - 1, Math.max(0, s)), w]);
      total += w;
    }
    taps.push(list.map(([s, w]) => [s, w / total]));
  }
  return taps;
}

/**
 * Downscales a square image to `size` with a Lanczos-3 filter in premultiplied alpha (no dark fringes);
 * the result is clamped so the filter's small overshoot never produces invalid colors.
 */
function resize(master, size) {
  const n = master.width;
  if (size > n) throw new Error(`cannot upscale the ${n}px master to ${size}px`);
  const pre = new Float64Array(n * n * 4);
  for (let i = 0; i < n * n; i += 1) {
    const a = master.rgba[i * 4 + 3] / 255;
    pre[i * 4] = master.rgba[i * 4] * a;
    pre[i * 4 + 1] = master.rgba[i * 4 + 1] * a;
    pre[i * 4 + 2] = master.rgba[i * 4 + 2] * a;
    pre[i * 4 + 3] = a;
  }
  const taps = lanczosWeights(n, size);
  const horizontal = new Float64Array(size * n * 4);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const o = (y * size + x) * 4;
      for (const [s, w] of taps[x]) {
        const i = (y * n + s) * 4;
        for (let c = 0; c < 4; c += 1) horizontal[o + c] += pre[i + c] * w;
      }
    }
  }
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = [0, 0, 0, 0];
      for (const [s, w] of taps[y]) {
        const i = (s * size + x) * 4;
        for (let c = 0; c < 4; c += 1) px[c] += horizontal[i + c] * w;
      }
      const a = Math.min(1, px[3]);
      const alpha = Math.round(a * 255);
      if (alpha <= 0) continue;
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) rgba[o + c] = Math.round(Math.min(255, Math.max(0, px[c] / a)));
      rgba[o + 3] = alpha;
    }
  }
  return { width: size, height: size, rgba };
}

// ---------------------------------------------------------------------------------------------- ICO

/** Classic 32-bit DIB icon entry (BGRA bottom-up plus an AND mask): readable by every Windows tool. */
function encodeDib({ width, height, rgba }) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(width * height * 4);
  const maskStride = Math.ceil(width / 32) * 4;
  const mask = Buffer.alloc(maskStride * height);
  for (let y = 0; y < height; y += 1) {
    const row = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const o = (row * width + x) * 4;
      pixels[o] = rgba[i + 2];
      pixels[o + 1] = rgba[i + 1];
      pixels[o + 2] = rgba[i];
      pixels[o + 3] = rgba[i + 3];
      if (!rgba[i + 3]) mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, pixels, mask]);
}

/** Multi-size .ico: DIB entries below 256 px, a PNG entry for 256 px (as Windows' own icons do). */
function encodeIco(images) {
  const blobs = images.map((img) => (img.width >= 256 ? encodePng(img) : encodeDib(img)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map((img, k) => {
    const e = Buffer.alloc(16);
    e[0] = img.width >= 256 ? 0 : img.width;
    e[1] = img.height >= 256 ? 0 : img.height;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(blobs[k].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += blobs[k].length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...blobs]);
}

// ------------------------------------------------------------------------------------- Open Graph

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

function ogHtml(logoPng) {
  const logo = `data:image/png;base64,${logoPng.toString('base64')}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${OG_WIDTH}px;height:${OG_HEIGHT}px;overflow:hidden}
  body{display:flex;align-items:center;justify-content:center;gap:56px;
    background:radial-gradient(circle at 22% 30%,#e3ecff 0,transparent 55%),
      radial-gradient(circle at 85% 80%,#efe3ff 0,transparent 50%),#f7f8fc;
    font-family:'Segoe UI Variable Display','Segoe UI',Inter,Ubuntu,'Noto Sans',sans-serif;color:#141726}
  img{width:340px;height:340px;filter:drop-shadow(0 18px 36px rgb(76 92 255 / 28%))}
  h1{margin:0;font-size:96px;line-height:1.05;letter-spacing:-0.02em;font-weight:700}
  p{margin:18px 0 0;font-size:36px;line-height:1.3;color:#4b5268;max-width:560px}
  </style></head><body><img src="${logo}" alt=""><div><h1>Infinity Notes</h1>
  <p>Offline notes, stickies and reminders for Windows and Linux</p></div></body></html>`;
}

/** Runs inside Electron once the app is ready: renders the card offscreen and writes it as PNG. */
async function renderOgInElectron(BrowserWindow, logoFile, outFile) {
  const win = new BrowserWindow({
    width: OG_WIDTH,
    height: OG_HEIGHT,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true, javascript: false },
  });
  const html = ogHtml(fs.readFileSync(logoFile));
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  // Let the offscreen compositor paint the loaded frame before capturing it.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = await win.webContents.capturePage();
  const { width, height } = image.getSize();
  if (width !== OG_WIDTH || height !== OG_HEIGHT) {
    throw new Error(`Open Graph capture is ${width}x${height}, expected ${OG_WIDTH}x${OG_HEIGHT}`);
  }
  fs.writeFileSync(outFile, image.toPNG());
}

function renderOg(logoFile, outFile) {
  // In plain Node the electron package exports the path of its binary.
  const electronBinary = createRequire(import.meta.url)('electron');
  if (!fs.existsSync(electronBinary)) {
    throw new Error('Electron is not installed; run npm ci and npm run setup:electron first');
  }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-notes-brand-'));
  const env = { ...process.env, BRAND_OG_LOGO: logoFile, BRAND_OG_OUT: outFile, BRAND_OG_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const result = spawnSync(electronBinary, [fileURLToPath(import.meta.url)], { env, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Electron Open Graph render failed (exit ${result.status})`);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------------------------- Main

function write(rel, data) {
  const file = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`wrote ${rel.replaceAll('\\', '/')} (${data.length} bytes)`);
}

function buildAssets({ withOg }) {
  const { image, cleared, dropped } = removeDust(decodePng(SOURCE));
  const master = squareToContent(image);
  console.log(
    `cleaned source: ${cleared} dust pixels cleared, ${dropped} detached specks dropped; ` +
      `content ${master.content.width}x${master.content.height} on a ${master.width}px square`,
  );
  const cache = new Map();
  const sized = (size) => {
    if (!cache.has(size)) cache.set(size, resize(master, size));
    return cache.get(size);
  };
  const png = (size) => encodePng(sized(size));

  write('resources/icon.png', png(512));
  write('resources/icon.ico', encodeIco(ICO_SIZES.map(sized)));
  for (const size of LINUX_SIZES) write(`resources/icons/${size}x${size}.png`, png(size));
  for (const size of LOGO_SIZES) write(`resources/brand/logo-${size}.png`, png(size));
  for (const size of TRAY_SIZES) write(`resources/brand/tray-${size}.png`, png(size));
  write('website/assets/logo.png', png(256));
  write('website/assets/favicon.ico', encodeIco(FAVICON_SIZES.map(sized)));

  if (withOg) {
    renderOg(path.join(repoRoot, 'resources', 'icons', '512x512.png'), path.join(repoRoot, 'website', 'assets', 'og-image.png'));
    console.log('wrote website/assets/og-image.png');
  }
}

if (process.versions.electron) {
  // Spawned by renderOg(). No top-level await on app.whenReady(): it would block the ESM main module
  // from finishing to load, and Electron only becomes ready after that.
  const { app, BrowserWindow } = await import('electron');
  app.setPath('userData', process.env.BRAND_OG_USER_DATA);
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.disableHardwareAcceleration();
  app
    .whenReady()
    .then(() => renderOgInElectron(BrowserWindow, process.env.BRAND_OG_LOGO, process.env.BRAND_OG_OUT))
    .then(
      () => app.exit(0),
      (err) => {
        console.error(err);
        app.exit(1);
      },
    );
} else {
  buildAssets({ withOg: process.argv.includes('--og') });
}
