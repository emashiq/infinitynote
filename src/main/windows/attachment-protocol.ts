import fs from 'node:fs';
import path from 'node:path';
import { UUID_RE } from '../../shared/contracts/ids';
import { isInside } from '../app-paths';
import type { Db } from '../db/driver';
import { AttachmentsRepo, type AttachmentRow } from '../db/repositories/attachments-repo';
import type { Logger } from '../services/logger';
import { nullLogger } from '../services/logger';

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function empty(status: number): Response {
  return new Response(null, { status });
}

/**
 * infinity-attachment://<uuid> handler (INF-FND-08). The only input that reaches the database is a canonical
 * UUID; the file path always comes from the stored row. The file must not be a symbolic link and its real path
 * must be inside the real attachments directory, so a link or junction placed under attachments/ cannot expose
 * other files (F-01-2). Documents are never served.
 */
export function createAttachmentHandler(options: {
  db: Db | null;
  dataDir: string;
  logger?: Logger;
}): (request: Request) => Promise<Response> {
  const logger = options.logger ?? nullLogger;
  const repo = options.db ? new AttachmentsRepo(options.db) : null;
  const root = path.join(options.dataDir, 'attachments');
  let realRoot: string | null = null;

  const containedFile = async (row: AttachmentRow): Promise<string | null> => {
    const abs = path.resolve(options.dataDir, row.managed_relative_path);
    if (!isInside(root, abs)) return null;
    const stat = await fs.promises.lstat(abs);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    realRoot ??= await fs.promises.realpath(root);
    const real = await fs.promises.realpath(abs);
    return isInside(realRoot, real) ? real : null;
  };

  return async (request) => {
    if (request.method !== 'GET') return empty(405);
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return empty(404);
    }
    if (!UUID_RE.test(url.host) || (url.pathname !== '' && url.pathname !== '/')) return empty(404);
    if (!repo) return empty(404);
    const id = url.host;
    let row: AttachmentRow | undefined;
    try {
      row = repo.get(id);
    } catch {
      return empty(404);
    }
    if (!row) return empty(404);
    if (row.kind !== 'image' || !IMAGE_MIME.has(row.mime)) return empty(404);
    let body: Buffer;
    try {
      const file = await containedFile(row);
      if (!file) {
        logger.warn(`attachment: containment violation id=${id}`);
        return empty(404);
      }
      body = await fs.promises.readFile(file);
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
