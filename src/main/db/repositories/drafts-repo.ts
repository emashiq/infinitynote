import type { Db } from '../driver';

export type DraftReason = 'conflict' | 'lease_lost';

export interface DraftRow {
  id: string;
  note_id: string;
  base_revision: number;
  format: 'rich' | 'plain';
  title: string | null;
  content: string;
  reason: DraftReason;
  created_at: number;
}

export interface DraftInput {
  id: string;
  noteId: string;
  viewId: string;
  baseRevision: number;
  format: 'rich' | 'plain';
  title?: string;
  content: string;
  reason: DraftReason;
  now: number;
}

const COLUMNS = 'id, note_id, base_revision, format, title, content, reason, created_at';

/** Rejected edits kept for the user (note_drafts). Rows are resolved, never deleted, in Phase 03. */
export class DraftsRepo {
  constructor(private readonly db: Db) {}

  insert(draft: DraftInput): void {
    this.db
      .prepare<[string, string, string, number, string, string | null, string, string, number]>(
        'INSERT INTO note_drafts(id, note_id, view_id, base_revision, format, title, content, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(draft.id, draft.noteId, draft.viewId, draft.baseRevision, draft.format, draft.title ?? null, draft.content, draft.reason, draft.now);
  }

  /** Unresolved drafts of a note, newest first. */
  listOpen(noteId: string, limit: number): DraftRow[] {
    return this.db
      .prepare<[string, number], DraftRow>(
        `SELECT ${COLUMNS} FROM note_drafts WHERE note_id = ? AND resolved_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(noteId, limit);
  }

  getOpen(noteId: string, draftId: string): DraftRow | undefined {
    return this.db
      .prepare<[string, string], DraftRow>(`SELECT ${COLUMNS} FROM note_drafts WHERE id = ? AND note_id = ? AND resolved_at IS NULL`)
      .get(draftId, noteId);
  }

  resolve(draftId: string, now: number): void {
    this.db.prepare<[number, string]>('UPDATE note_drafts SET resolved_at = ? WHERE id = ?').run(now, draftId);
  }
}
