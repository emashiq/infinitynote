import fs from 'node:fs';
import path from 'node:path';
import { RENDERER_HOST } from '../../shared/app-identity';
import { PDF_WORKER_CSP, PROD_CSP } from '../../shared/csp';
import { PDFJS_ASSETS_DIR } from '../../shared/documents/pdf-assets';
import { resolveContained } from '../app-paths';
import type { Logger } from '../services/logger';
import { nullLogger } from '../services/logger';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  // pdf.js run-time files (D-128): WebAssembly decoders, packed character maps, standard fonts, ICC profiles.
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.icc': 'application/vnd.iccprofile',
};

function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'X-Content-Type-Options': 'nosniff' } });
}

/**
 * Serves the built renderer from `root` under infinity-app://renderer/ (D-035). The pure
 * request -> response function is registered with protocol.handle in the main process.
 */
export function createRendererHandler(options: { root: string; logger?: Logger }): (request: Request) => Promise<Response> {
  const logger = options.logger ?? nullLogger;
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405 });
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return notFound();
    }
    if (url.host !== RENDERER_HOST) return notFound();
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return notFound();
    }
    if (rel.includes('\0')) return notFound();
    if (rel === '' || rel === '/') rel = '/index.html';
    rel = rel.replace(/^\/+/, '');
    const ext = path.extname(rel).toLowerCase();
    const mime = MIME[ext];
    if (!mime) return notFound();
    const abs = resolveContained(options.root, rel);
    if (!abs) {
      logger.warn('renderer: containment violation');
      return notFound();
    }
    let body: Buffer;
    try {
      body = await fs.promises.readFile(abs);
    } catch {
      return notFound();
    }
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    };
    if (ext === '.html') headers['Content-Security-Policy'] = PROD_CSP;
    else if (rel.startsWith(`${PDFJS_ASSETS_DIR}/`)) headers['Content-Security-Policy'] = PDF_WORKER_CSP;
    return new Response(new Uint8Array(body), { status: 200, headers });
  };
}
