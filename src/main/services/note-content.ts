import { DocSchemaError, normalizeRichDoc, type RichDocLike } from '../../shared/editor/doc-schema';
import type { Db } from '../db/driver';
import { NotesRepo } from '../db/repositories/notes-repo';
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
 * next revision. Must run inside the caller's transaction (save, conversion, version and draft restore).
 */
export class NoteContent {
  private readonly notes: NotesRepo;

  constructor(
    db: Db,
    private readonly indexer: ContentIndexer,
  ) {
    this.notes = new NotesRepo(db);
  }

  write(w: ContentWrite): { revision: number; updatedAt: number } {
    const { plainText } = this.indexer.index(w.noteId, w.format, w.content, w.now);
    const written = this.notes.writeContent({
      id: w.noteId,
      format: w.format,
      content: typeof w.content === 'string' ? w.content : JSON.stringify(w.content),
      plainText,
      title: w.title,
      expectedRevision: w.expectedRevision,
      now: w.now,
    });
    if (!written) throw new Error(`note ${w.noteId} is no longer at revision ${w.expectedRevision}`);
    return { revision: w.expectedRevision + 1, updatedAt: w.now };
  }
}
