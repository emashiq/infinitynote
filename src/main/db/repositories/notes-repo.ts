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
}
