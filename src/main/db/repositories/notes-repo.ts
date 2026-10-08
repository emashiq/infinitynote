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

export interface OpenRow {
  id: string;
  format: 'rich' | 'plain';
  content_json: string | null;
  content_text: string | null;
  revision: number;
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

  /** Row needed to open a note in an editor. */
  getOpenRow(id: string): OpenRow | undefined {
    return this.db
      .prepare<[string], OpenRow>(
        'SELECT id, format, content_json, content_text, revision, deleted_at, trash_batch_id FROM notes WHERE id = ?',
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

  /** What a save needs to know about the stored note. */
  getSaveState(id: string): SaveStateRow | undefined {
    return this.db.prepare<[string], SaveStateRow>('SELECT format, revision, deleted_at FROM notes WHERE id = ?').get(id);
  }

  /** Writes new content (and the title when given) as the next revision. */
  writeContent(input: WriteContentInput): void {
    this.db
      .prepare<[string | null, string | null, string, string | null, number, number, string]>(
        'UPDATE notes SET content_json = ?, content_text = ?, plain_text = ?, title = COALESCE(?, title), revision = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        input.format === 'rich' ? input.content : null,
        input.format === 'plain' ? input.content : null,
        input.plainText,
        input.title ?? null,
        input.revision,
        input.now,
        input.id,
      );
  }

  insertDraft(draft: DraftInput): void {
    this.db
      .prepare<[string, string, string, number, string, string | null, string, string, number]>(
        'INSERT INTO note_drafts(id, note_id, view_id, base_revision, format, title, content, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(draft.id, draft.noteId, draft.viewId, draft.baseRevision, draft.format, draft.title ?? null, draft.content, draft.reason, draft.now);
  }

  /** 'live' or 'trashed' for each of the ids that still exists. */
  states(ids: readonly string[]): Map<string, 'live' | 'trashed'> {
    const rows = this.db
      .prepare<[string], { id: string; deleted_at: number | null }>('SELECT id, deleted_at FROM notes WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(ids));
    return new Map(rows.map((r) => [r.id, r.deleted_at === null ? 'live' : 'trashed']));
  }
}

export interface SaveStateRow {
  format: 'rich' | 'plain';
  revision: number;
  deleted_at: number | null;
}

export interface WriteContentInput {
  id: string;
  format: 'rich' | 'plain';
  /** Serialized content: document JSON for rich notes, the text for plain notes. */
  content: string;
  plainText: string;
  title?: string;
  revision: number;
  now: number;
}

export interface DraftInput {
  id: string;
  noteId: string;
  viewId: string;
  baseRevision: number;
  format: 'rich' | 'plain';
  title?: string;
  content: string;
  reason: 'conflict' | 'lease_lost';
  now: number;
}
