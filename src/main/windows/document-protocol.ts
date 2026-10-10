import fs from 'node:fs';
import { Readable } from 'node:stream';
import { UUID_RE } from '../../shared/contracts/ids';
import { HTML_DOCUMENT_CSP } from '../../shared/csp';
import { DOCUMENT_KIND_INFO } from '../../shared/documents/kinds';
import type { ByteSource } from '../documents/byte-source';
import { readHead } from '../documents/document-check';
import type { DocumentService, DocumentSource } from '../documents/document-service';
import { bomEncoding, isUtf8 } from '../documents/text-encoding';
import { AppError } from '../services/app-error';
import type { Logger } from '../services/logger';
import { nullLogger } from '../services/logger';

/** A satisfiable byte range of a file, inclusive. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * The single byte range a `Range` header asks for (RFC 9110 14.1.2): `bytes=a-b`, `bytes=a-` or the suffix `bytes=-n`.
 * Null when there is no usable header (several ranges or another unit are answered with the whole file);
 * 'unsatisfiable' when the range lies outside the file.
 */
export function parseByteRange(header: string | null, size: number): ByteRange | null | 'unsatisfiable' {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

function empty(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { 'X-Content-Type-Options': 'nosniff', ...headers } });
}

/** The bytes of a source (or a range of them): a file is streamed; a locked document's decrypted bytes are in memory. */
function body(source: ByteSource, range?: ByteRange): BodyInit {
  if (typeof source !== 'string') {
    // A view of exactly these bytes (a small Buffer may sit in Node's shared pool, hence the offset and length); the
    // cast only narrows the type: decrypted bytes are never in a SharedArrayBuffer.
    const bytes = new Uint8Array(source.buffer as ArrayBuffer, source.byteOffset, source.byteLength);
    return range ? bytes.subarray(range.start, range.end + 1) : bytes;
  }
  return Readable.toWeb(fs.createReadStream(source, range)) as ReadableStream<Uint8Array>;
}

/** Who answers for a document's bytes: DocumentService, which decrypts a locked document's in memory (D-185). */
export type DocumentSources = Pick<DocumentService, 'sourceOf'>;

/**
 * The document ID of a URL `<scheme>://<uuid>/` (a query is allowed) and the version a `version=<uuid>` query names,
 * or null for anything else.
 */
function documentOf(rawUrl: string): { id: string; versionId: string | null } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!UUID_RE.test(url.host) || (url.pathname !== '' && url.pathname !== '/')) return null;
  const versionId = url.searchParams.get('version');
  if (versionId !== null && !UUID_RE.test(versionId)) return null;
  return { id: url.host, versionId };
}

/** The bytes a URL names; 'locked' for a locked document whose key is not in memory, null for anything not there. */
async function lookup(documents: DocumentSources | null, request: Request, logger: Logger, versions: 'versions' | 'current'): Promise<DocumentSource | 'locked' | null> {
  const target = documentOf(request.url);
  if (!target || !documents || (target.versionId !== null && versions === 'current')) return null;
  const { id, versionId } = target;
  try {
    return await documents.sourceOf(id, versionId ?? undefined);
  } catch (err) {
    if (err instanceof AppError && err.code === 'FORBIDDEN') return 'locked';
    if (!(err instanceof AppError && err.code === 'NOT_FOUND')) logger.warn(`documents: protocol lookup failed id=${id} ${(err as Error).name}`);
    return null;
  }
}

/**
 * infinity-document://<documentId>/ (D-118): a live document's bytes for the viewers, with byte ranges (pdf.js reads
 * large files in ranges) and HEAD; `?version=<versionId>` serves one of its stored versions (D-141). Only a document ID
 * reaches the lookup; the file always comes from the stored row and is checked as in DocumentFiles. A locked document is
 * served only while it is unlocked, from memory (403 otherwise, D-185); nothing is cached (`no-store`). The renderer
 * origin may read it across origins; nothing else gets a CORS grant.
 */
export function createDocumentHandler(options: { documents: DocumentSources | null; allowedOrigins: readonly string[]; logger?: Logger }): (request: Request) => Promise<Response> {
  const logger = options.logger ?? nullLogger;
  return async (request) => {
    const origin = request.headers.get('origin');
    const cors: Record<string, string> =
      origin !== null && options.allowedOrigins.includes(origin)
        ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range', Vary: 'Origin' }
        : {};
    if (request.method === 'OPTIONS') return empty(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Range' });
    if (request.method !== 'GET' && request.method !== 'HEAD') return empty(405);
    const found = await lookup(options.documents, request, logger, 'versions');
    if (found === 'locked') return empty(403, cors);
    if (!found) return empty(404, cors);
    const headers: Record<string, string> = {
      ...cors,
      'Content-Type': DOCUMENT_KIND_INFO[found.kind].mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'",
      'Accept-Ranges': 'bytes',
    };
    const range = parseByteRange(request.headers.get('range'), found.sizeBytes);
    if (range === 'unsatisfiable') return empty(416, { ...headers, 'Content-Range': `bytes */${found.sizeBytes}` });
    const head = request.method === 'HEAD';
    if (range === null) {
      return new Response(head ? null : body(found.source), { status: 200, headers: { ...headers, 'Content-Length': String(found.sizeBytes) } });
    }
    return new Response(head ? null : body(found.source, range), {
      status: 206,
      headers: { ...headers, 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${found.sizeBytes}` },
    });
  };
}

const CHARSET_SAMPLE_BYTES = 64 * 1024;

/**
 * The charset to declare for an HTML file: its byte-order mark, else UTF-8 when it reads as UTF-8; otherwise none, so
 * the page's own `<meta charset>` decides.
 */
export async function htmlCharset(source: ByteSource): Promise<string | null> {
  const sample = await readHead(source, CHARSET_SAMPLE_BYTES);
  return bomEncoding(sample) ?? (isUtf8(sample, sample.length === CHARSET_SAMPLE_BYTES) ? 'utf-8' : null);
}

/**
 * infinity-html://<documentId>/ (D-118, F6): an HTML document for the viewer's sandboxed frame, under a policy that
 * allows no script and no network (HTML_DOCUMENT_CSP). Only the page itself is served: relative resources of the page
 * get 404, since an imported HTML document is a single file.
 */
export function createHtmlDocumentHandler(options: { documents: DocumentSources | null; logger?: Logger }): (request: Request) => Promise<Response> {
  const logger = options.logger ?? nullLogger;
  return async (request) => {
    if (request.method !== 'GET') return empty(405);
    const found = await lookup(options.documents, request, logger, 'current');
    if (found === 'locked') return empty(403);
    if (!found || found.kind !== 'html') return empty(404);
    const charset = await htmlCharset(found.source).catch(() => null);
    return new Response(body(found.source), {
      status: 200,
      headers: {
        'Content-Type': charset ? `text/html; charset=${charset}` : 'text/html',
        'Content-Security-Policy': HTML_DOCUMENT_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
  };
}
