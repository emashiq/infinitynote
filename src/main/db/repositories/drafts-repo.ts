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

/**
 * Rejected edits kept for the user (note_drafts). Open drafts are never deleted; from Phase 08 the oldest open
 * `lease_lost` drafts beyond a per-note cap are resolved, and resolved drafts are deleted after a while (F-03-4).
 */
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

  /** Resolves each note's oldest open `lease_lost` drafts beyond the newest `keep` (only for `noteId` when given). */
  capOpenLeaseLost(keep: number, now: number, noteId: string | null = null): number {
    return this.db
      .prepare<[number, string | null, string | null, number]>(
        `UPDATE note_drafts SET resolved_at = ? WHERE id IN (
           SELECT id FROM (
             SELECT id, row_number() OVER (PARTITION BY note_id ORDER BY created_at DESC, rowid DESC) AS n
             FROM note_drafts WHERE reason = 'lease_lost' AND resolved_at IS NULL AND (? IS NULL OR note_id = ?))
           WHERE n > ?)`,
      )
      .run(now, noteId, noteId, keep).changes;
  }

  deleteResolvedBefore(cutoff: number): number {
    return this.db.prepare<[number]>('DELETE FROM note_drafts WHERE resolved_at IS NOT NULL AND resolved_at < ?').run(cutoff).changes;
  }

  /** The content of every open draft (attachment GC reads the attachments they use). */
  openContents(): Array<{ format: 'rich' | 'plain'; content: string }> {
    return this.db.prepare<[], { format: 'rich' | 'plain'; content: string }>('SELECT format, content FROM note_drafts WHERE resolved_at IS NULL').all();
  }

  resolve(draftId: string, now: number): void {
    this.db.prepare<[number, string]>('UPDATE note_drafts SET resolved_at = ? WHERE id = ?').run(now, draftId);
  }
}
