import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { PRINT_PAGE_SCHEME } from '../../shared/app-identity';
import { NOTE_HTML_CSP } from '../portability/note-html';
import { errorMessage } from '../services/app-error';
import type { Logger } from '../services/logger';

/**
 * The session of the hidden print window (D-176). Without the `persist:` prefix Electron keeps it in memory only, so
 * neither the page nor its cache, cookies or storage reach the disk.
 */
export const PRINT_PARTITION = 'infinity-print';

export interface PrintPage {
  /** `infinity-print://<token>/`: the page's own origin, by a random token. */
  readonly url: string;
  /** Forgets the page: its URL answers 404 from then on. */
  release(): void;
}

/** Pages waiting to be printed or turned into a PDF, held in memory and served by token only. */
export interface PrintPages {
  add(html: string): PrintPage;
  respond(request: { url: string; method: string }): Response;
}

const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

const notFound = () => new Response(null, { status: 404, headers: HEADERS });

/**
 * The page store behind the print scheme's handler: a page is served while registered, at its token's root only, with
 * the exported page's policy (no script, no network) as a header as well as its meta tag.
 */
export function createPrintPages(token: () => string = randomUUID): PrintPages {
  const pages = new Map<string, string>();
  return {
    add(html) {
      const key = token();
      pages.set(key, html);
      return { url: `${PRINT_PAGE_SCHEME}://${key}/`, release: () => void pages.delete(key) };
    },
    respond({ url, method }) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return notFound();
      }
      const html = parsed.protocol === `${PRINT_PAGE_SCHEME}:` && parsed.pathname === '/' && parsed.search === '' && method === 'GET' ? pages.get(parsed.hostname) : undefined;
      if (html === undefined) return notFound();
      return new Response(html, { status: 200, headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': NOTE_HTML_CSP } });
    },
  };
}

/**
 * Deletes the folder where earlier builds wrote print pages as files (`data/export-tmp`): a page left there by a crash
 * or a power cut while the print dialog was open may hold an unlocked locked note's text. Returns the number of files.
 */
export async function removeLeftoverPrintPages(dir: string, logger: Logger): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return 0;
  }
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (err) {
    logger.warn(`print: leftover pages not removed: ${errorMessage(err)}`);
    return 0;
  }
  return entries.length;
}
