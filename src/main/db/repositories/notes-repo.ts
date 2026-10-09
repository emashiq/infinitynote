import type { Db } from '../driver';

export interface NoteRow {
  doc_key: number;
  id: string;
  title: string;
  format: 'rich' | 'plain';
  content_json: string | null;
  content_text: string | null;
  plain_text: string;
  revision: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** The stored content of a note and what a reader or writer must know about it. */
export interface ContentRow {
  id: string;
  title: string;
  format: 'rich' | 'plain';
  content_json: string | null;
  content_text: string | null;
  plain_text: string;
  revision: number;
  /** 1 while the note is locked: its content is then encrypted in note_locks and these columns are empty (D-111). */
  locked: number;
  deleted_at: number | null;
  trash_batch_id: string | null;
}

export interface CreateNoteInput {
  id: string;
  title?: string;
  format: 'rich' | 'plain';
  contentJson?: string | null;
  contentText?: string | null;
  plainText?: string;
  now: number;
  projectId?: string | null;
  folderId?: string | null;
  sticky?: boolean;
  color?: string | null;
}

export interface WriteContentInput {
  id: string;
  format: 'rich' | 'plain';
  /** Serialized content: document JSON for rich notes, the text for plain notes; null for a locked note (D-111). */
  content: string | null;
  plainText: string;
  /** New title, or null to keep the current one. */
  title: string | null;
  /** The revision the write is based on; the row is written only while it still has this revision. */
  expectedRevision: number;
  now: number;
}

export class NotesRepo {
  constructor(private readonly db: Db) {}

  createNote(input: CreateNoteInput): void {
    this.db
      .prepare<[string, string | null, string | null, string, string, string | null, string | null, string, number, string | null, number, number]>(
        'INSERT INTO notes(id, project_id, folder_id, title, format, content_json, content_text, plain_text, sticky_enabled, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        input.id,
        input.projectId ?? null,
        input.folderId ?? null,
        input.title ?? '',
        input.format,
        input.format === 'rich' ? (input.contentJson ?? null) : null,
        input.format === 'plain' ? (input.contentText ?? '') : null,
        input.plainText ?? '',
        input.sticky ? 1 : 0,
        input.color ?? null,
        input.now,
        input.now,
      );
  }

  getContentRow(id: string): ContentRow | undefined {
    return this.db
      .prepare<[string], ContentRow>(
        'SELECT id, title, format, content_json, content_text, plain_text, revision, locked, deleted_at, trash_batch_id FROM notes WHERE id = ?',
      )
      .get(id);
  }

  getNoteById(id: string): NoteRow | undefined {
    return this.db
      .prepare<[string], NoteRow>(
        'SELECT doc_key, id, title, format, content_json, content_text, plain_text, revision, created_at, updated_at, deleted_at FROM notes WHERE id = ?',
      )
      .get(id);
  }

  /** Writes content (format, text and plain text) as the next revision. Returns false when the revision moved on. */
  writeContent(input: WriteContentInput): boolean {
    const result = this.db
      .prepare<[string, string | null, string | null, string, string | null, number, string, number]>(
        'UPDATE notes SET format = ?, content_json = ?, content_text = ?, plain_text = ?, title = COALESCE(?, title), revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
      )
      .run(
        input.format,
        input.format === 'rich' ? input.content : null,
        input.format === 'plain' ? input.content : null,
        input.plainText,
        input.title,
        input.now,
        input.id,
        input.expectedRevision,
      );
    return result.changes === 1;
  }

  isLocked(id: string): boolean {
    return this.db.prepare<[string], { locked: number }>('SELECT locked FROM notes WHERE id = ?').get(id)?.locked === 1;
  }

  /** Empties a note's stored content and plain text (its search index row keeps only the title) before it is locked. */
  clearContent(id: string): void {
    this.db.prepare<[string]>("UPDATE notes SET content_json = NULL, content_text = NULL, plain_text = '' WHERE id = ?").run(id);
  }

  /** Puts content and plain text back into the row of a note whose lock was just removed (no new revision). */
  restoreContent(id: string, format: 'rich' | 'plain', content: string, plainText: string): void {
    this.db
      .prepare<[string | null, string | null, string, string]>('UPDATE notes SET content_json = ?, content_text = ?, plain_text = ? WHERE id = ?')
      .run(format === 'rich' ? content : null, format === 'plain' ? content : null, plainText, id);
  }

  /** 'live' or 'trashed' for each of the ids that still exists. */
  states(ids: readonly string[]): Map<string, 'live' | 'trashed'> {
    const rows = this.db
      .prepare<[string], { id: string; deleted_at: number | null }>('SELECT id, deleted_at FROM notes WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(ids));
    return new Map(rows.map((r) => [r.id, r.deleted_at === null ? 'live' : 'trashed']));
  }
}

type StoredContent = Pick<ContentRow, 'format' | 'content_json' | 'content_text'>;

/** The stored content exactly as serialized in the database. */
export function serializedContent(row: StoredContent): string {
  return row.format === 'rich' ? (row.content_json ?? '{"type":"doc"}') : (row.content_text ?? '');
}

/** The stored content in its editor form: a parsed document for rich notes, the text for plain notes. */
export function storedContent(row: StoredContent): unknown {
  return row.format === 'rich' ? JSON.parse(serializedContent(row)) : serializedContent(row);
}
