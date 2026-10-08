import fs from 'node:fs';
import path from 'node:path';
import { UUID_RE } from '../../shared/contracts/ids';
import { isInside } from '../app-paths';
import type { Db } from '../db/driver';
import type { Logger } from '../services/logger';
import { nullLogger } from '../services/logger';

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

interface AttachmentRow {
  managed_relative_path: string;
  mime: string;
  kind: string;
}

function empty(status: number): Response {
  return new Response(null, { status });
}

/**
 * infinity-attachment://<uuid> handler (INF-FND-08). The only input that reaches the database
 * is a canonical UUID; the file path always comes from the stored row and is checked for
 * containment inside <dataDir>/attachments. Documents are never served inline.
 */
export function createAttachmentHandler(options: {
  db: Db | null;
  dataDir: string;
  logger?: Logger;
}): (request: Request) => Promise<Response> {
  const logger = options.logger ?? nullLogger;
  return async (request) => {
    if (request.method !== 'GET') return empty(405);
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return empty(404);
    }
    if (!UUID_RE.test(url.host) || (url.pathname !== '' && url.pathname !== '/')) return empty(404);
    if (!options.db) return empty(404);
    const id = url.host;
    let row: AttachmentRow | undefined;
    try {
      row = options.db
        .prepare<[string], AttachmentRow>('SELECT managed_relative_path, mime, kind FROM attachments WHERE id = ?')
        .get(id);
    } catch {
      return empty(404);
    }
    if (!row) return empty(404);
    if (row.kind !== 'image' || !IMAGE_MIME.has(row.mime)) return empty(404);
    const abs = path.resolve(options.dataDir, row.managed_relative_path);
    if (!isInside(path.join(options.dataDir, 'attachments'), abs)) {
      logger.warn(`attachment: containment violation id=${id}`);
      return empty(404);
    }
    let body: Buffer;
    try {
      body = await fs.promises.readFile(abs);
    } catch {
      return empty(404);
    }
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        'Content-Type': row.mime,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'",
      },
    });
  };
}
