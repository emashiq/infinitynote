import { DocSchemaError, normalizeRichDoc, type RichDocLike } from '../../shared/editor/doc-schema';
import { PLAIN_COMMENTS, sealedComments } from '../comments/comment-cipher';
import { CommentQuotes } from '../comments/comment-quotes';
import type { Db } from '../db/driver';
import { NotesRepo } from '../db/repositories/notes-repo';
import type { NoteVault } from '../locks/note-vault';
import { AppError } from './app-error';
import type { ContentIndexer } from './content-indexer';

export const UNSAVABLE_CONTENT = 'This note contains content that cannot be saved';

export type NoteContentValue = RichDocLike | string;

export interface ContentWrite {
  noteId: string;
  format: 'rich' | 'plain';
  /** Already normalized content (see normalizeContent). */
  content: NoteContentValue;
  /** New title, or null to keep the current one. */
  title: string | null;
  expectedRevision: number;
  now: number;
}

/** Validates content for its format; rich documents go through the shared schema (D-053). */
export function normalizeContent(format: 'rich' | 'plain', content: unknown): NoteContentValue {
  if (format === 'plain') {
    if (typeof content !== 'string') throw new AppError('VALIDATION_FAILED', UNSAVABLE_CONTENT);
    return content;
  }
  try {
    return normalizeRichDoc(content);
  } catch (err) {
    if (err instanceof DocSchemaError) throw new AppError('VALIDATION_FAILED', UNSAVABLE_CONTENT);
    throw err;
  }
}

/**
 * The single place that changes a note's content: indexes it (plain text, attachment links), then writes the
 * next revision. Must run inside the caller's transaction (save, conversion, version and draft restore). A locked
 * note's content is encrypted with its key and its row keeps no text (D-111); its links are still indexed, so its
 * attachments stay in use. The quotes of its comment threads follow the text (D-165).
 */
export class NoteContent {
  private readonly notes: NotesRepo;
  private readonly quotes: CommentQuotes;

  constructor(
    db: Db,
    private readonly indexer: ContentIndexer,
    private readonly vault: NoteVault,
  ) {
    this.notes = new NotesRepo(db);
    this.quotes = new CommentQuotes(db);
  }

  write(w: ContentWrite): { revision: number; updatedAt: number } {
    const locked = this.notes.isLocked(w.noteId);
    if (locked) this.vault.keyOf(w.noteId);
    const { plainText } = this.indexer.index(w.noteId, w.format, w.content, w.now);
    this.quotes.sync(w.noteId, w.format, w.content, () => (locked ? sealedComments(this.vault.keyOf(w.noteId), w.noteId) : PLAIN_COMMENTS));
    const serialized = typeof w.content === 'string' ? w.content : JSON.stringify(w.content);
    const written = this.notes.writeContent({
      id: w.noteId,
      format: w.format,
      content: locked ? null : serialized,
      plainText: locked ? '' : plainText,
      title: w.title,
      expectedRevision: w.expectedRevision,
      now: w.now,
    });
    if (!written) throw new Error(`note ${w.noteId} is no longer at revision ${w.expectedRevision}`);
    if (locked) this.vault.storeContent(w.noteId, serialized, w.now);
    return { revision: w.expectedRevision + 1, updatedAt: w.now };
  }
}
