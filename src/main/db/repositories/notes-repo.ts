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

export interface CreateNoteInput {
  id: string;
  title?: string;
  format: 'rich' | 'plain';
  contentJson?: string | null;
  contentText?: string | null;
  plainText?: string;
  now: number;
}

export class NotesRepo {
  constructor(private readonly db: Db) {}

  /** Minimal insert used by NoteWriter tests; Phase 02 extends this. */
  createNote(input: CreateNoteInput): void {
    this.db
      .prepare<[string, string, string, string | null, string | null, string, number, number]>(
        'INSERT INTO notes(id, title, format, content_json, content_text, plain_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        input.id,
        input.title ?? '',
        input.format,
        input.format === 'rich' ? (input.contentJson ?? null) : null,
        input.format === 'plain' ? (input.contentText ?? '') : null,
        input.plainText ?? '',
        input.now,
        input.now,
      );
  }

  getNoteById(id: string): NoteRow | undefined {
    return this.db
      .prepare<[string], NoteRow>(
        'SELECT doc_key, id, title, format, content_json, content_text, plain_text, revision, created_at, updated_at, deleted_at FROM notes WHERE id = ?',
      )
      .get(id);
  }
}
