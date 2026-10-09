import fs from 'node:fs';
import path from 'node:path';
import { PORTABILITY_MESSAGES } from '../../shared/contracts/portability';
import { collectAttachmentRefs, type RichDocLike } from '../../shared/editor/doc-schema';
import { extractPlainText } from '../../shared/text/plain-text';
import type { Db } from '../db/driver';
import { AttachmentsRepo } from '../db/repositories/attachments-repo';
import { NotesRepo, storedContent } from '../db/repositories/notes-repo';
import { AppError } from '../services/app-error';
import { containedAttachmentFile } from '../services/attachment-files';
import type { Logger } from '../services/logger';
import { richToMarkdown } from './markdown';

export interface NoteExportDeps {
  db: Db;
  dataDir: string;
  logger: Logger;
}

async function writeAtomically(file: string, text: string): Promise<void> {
  const part = `${file}.part`;
  await fs.promises.writeFile(part, text, 'utf8');
  await fs.promises.rename(part, file);
}

/** The folder next to an exported Markdown file that holds its images and files: "<name> files". */
export function assetsDirFor(file: string): string {
  return path.join(path.dirname(file), `${path.basename(file, path.extname(file))} files`);
}

/** Copies the note's attachments next to the Markdown file and returns their relative links. */
async function copyAssets(deps: NoteExportDeps, doc: RichDocLike, file: string): Promise<Map<string, string>> {
  const ids = [...new Set(collectAttachmentRefs(doc).map((r) => r.attachmentId))];
  const links = new Map<string, string>();
  if (ids.length === 0) return links;
  const repo = new AttachmentsRepo(deps.db);
  const dir = assetsDirFor(file);
  for (const id of ids) {
    const row = repo.get(id);
    const source = row ? await containedAttachmentFile(deps.dataDir, row.managed_relative_path).catch(() => null) : null;
    if (!row || !source) {
      deps.logger.warn(`export: attachment unavailable id=${id}`);
      continue;
    }
    await fs.promises.mkdir(dir, { recursive: true });
    const name = path.posix.basename(row.managed_relative_path);
    await fs.promises.copyFile(source, path.join(dir, name));
    links.set(id, `${encodeURI(path.basename(dir))}/${name}`);
  }
  return links;
}

/**
 * Exports one live note as Markdown or plain text (INF-PORT-05). Plain text is the note's text under its title;
 * Markdown keeps headings, emphasis, lists, checklists, quotes, code and links, with the documented losses.
 */
export async function writeNoteExport(deps: NoteExportDeps, noteId: string, format: 'markdown' | 'text', file: string): Promise<{ attachments: number }> {
  const row = new NotesRepo(deps.db).getContentRow(noteId);
  if (!row || row.deleted_at !== null) throw new AppError('NOT_FOUND', PORTABILITY_MESSAGES.noteMissing);
  const content = storedContent(row);
  if (format === 'text' || row.format === 'plain') {
    const text = extractPlainText(row.format, content);
    await writeAtomically(file, row.title ? `${row.title}\n\n${text}` : text);
    return { attachments: 0 };
  }
  const links = await copyAssets(deps, content as RichDocLike, file);
  await writeAtomically(file, richToMarkdown(row.title, content as RichDocLike, { linkOf: (id) => links.get(id) ?? null }));
  return { attachments: links.size };
}
