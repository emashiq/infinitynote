import fs from 'node:fs';
import katex from 'katex';
import { PORTABILITY_MESSAGES } from '../../shared/contracts/portability';
import { collectAttachmentRefs, type RichDocLike } from '../../shared/editor/doc-schema';
import { NotesRepo } from '../db/repositories/notes-repo';
import { AttachmentsRepo } from '../db/repositories/attachments-repo';
import { AppError } from '../services/app-error';
import { containedAttachmentFile } from '../services/attachment-files';
import type { NoteExportDeps } from './note-export';
import { plainToHtml, richToHtml } from './note-html';

/** Largest image embedded in an exported page, and all of a page's images together (D-163). */
export const MAX_EMBEDDED_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_EMBEDDED_TOTAL_BYTES = 100 * 1024 * 1024;

/** Turns a page into a PDF or prints it, in a window that is never shown (Electron; a fake in tests). */
export interface HtmlPrinter {
  toPdf(html: string): Promise<Uint8Array>;
  /** Opens the system print dialog for the page; false when the user canceled or printing failed. */
  print(html: string): Promise<boolean>;
}

/** KaTeX in main, as MathML (no fonts or CSS needed; Chromium and browsers draw it): never trusted commands. */
function mathMarkup(latex: string, display: boolean): string | null {
  try {
    return katex.renderToString(latex, { displayMode: display, output: 'mathml', trust: false, strict: 'ignore', maxSize: 20, maxExpand: 500, throwOnError: true });
  } catch {
    return null;
  }
}

/** The note's images as `data:` URLs, within the size limits; an image over them shows as unavailable. */
async function imageUrls(deps: NoteExportDeps, doc: RichDocLike): Promise<Map<string, string>> {
  const repo = new AttachmentsRepo(deps.db);
  const urls = new Map<string, string>();
  let total = 0;
  for (const id of new Set(collectAttachmentRefs(doc).map((r) => r.attachmentId))) {
    const row = repo.get(id);
    if (!row || row.kind !== 'image' || row.size_bytes > MAX_EMBEDDED_IMAGE_BYTES || total + row.size_bytes > MAX_EMBEDDED_TOTAL_BYTES) continue;
    const file = await containedAttachmentFile(deps.dataDir, row.managed_relative_path).catch(() => null);
    if (!file) {
      deps.logger.warn(`export: attachment unavailable id=${id}`);
      continue;
    }
    const bytes = await fs.promises.readFile(file);
    total += bytes.byteLength;
    urls.set(id, `data:${row.mime};base64,${bytes.toString('base64')}`);
  }
  return urls;
}

/**
 * The page of one live note (D-163), read through the vault (a locked note must be unlocked, like Markdown export).
 * `diagrams` maps each Mermaid source to the SVG the renderer drew for it.
 */
export async function buildNoteHtml(deps: NoteExportDeps, noteId: string, diagrams: ReadonlyMap<string, string>): Promise<{ title: string; html: string }> {
  const row = new NotesRepo(deps.db).getContentRow(noteId);
  if (!row || row.deleted_at !== null) throw new AppError('NOT_FOUND', PORTABILITY_MESSAGES.noteMissing);
  const serialized = deps.vault.serialized(row);
  if (row.format === 'plain') return { title: row.title, html: plainToHtml(row.title, serialized) };
  const doc = JSON.parse(serialized) as RichDocLike;
  const images = await imageUrls(deps, doc);
  const html = richToHtml(row.title, doc, { image: (id) => images.get(id) ?? null, diagram: (source) => diagrams.get(source) ?? null, math: mathMarkup });
  return { title: row.title, html };
}
