import type { Db } from '../driver';

export interface DismissalRow {
  dedupe_key: string;
  note_id: string;
  block_id: string | null;
  /** The normalized phrase. */
  span_text: string;
  span_ordinal: number;
  reference_date: string;
  created_at: number;
}

const COLS = 'dedupe_key, note_id, block_id, span_text, span_ordinal, reference_date, created_at';

/** SQL of `suggestion_dismissals` (migration 006, D-088). Callers own the transactions. */
export class DismissalsRepo {
  constructor(private readonly db: Db) {}

  /** Stores a dismissal; one with the same key is kept as it is. */
  insertIgnore(row: DismissalRow): void {
    this.db
      .prepare(
        `INSERT INTO suggestion_dismissals(${COLS}) VALUES (@dedupe_key, @note_id, @block_id, @span_text, @span_ordinal, @reference_date, @created_at)
         ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .run(row);
  }

  get(dedupeKey: string): DismissalRow | undefined {
    return this.db.prepare<[string], DismissalRow>(`SELECT ${COLS} FROM suggestion_dismissals WHERE dedupe_key = ?`).get(dedupeKey);
  }

  /** The newest dismissals of a note first. */
  listForNote(noteId: string, limit: number): DismissalRow[] {
    return this.db
      .prepare<[string, number], DismissalRow>(`SELECT ${COLS} FROM suggestion_dismissals WHERE note_id = ? ORDER BY created_at DESC, dedupe_key LIMIT ?`)
      .all(noteId, limit);
  }

  /** Keeps the newest `keep` dismissals of a note; returns how many were removed. */
  trimNote(noteId: string, keep: number): number {
    return this.db
      .prepare<[string, string, number]>(
        `DELETE FROM suggestion_dismissals WHERE note_id = ? AND dedupe_key NOT IN (
           SELECT dedupe_key FROM suggestion_dismissals WHERE note_id = ? ORDER BY created_at DESC, dedupe_key LIMIT ?)`,
      )
      .run(noteId, noteId, keep).changes;
  }

  /** Removes dismissals whose reference date is before `date` (YYYY-MM-DD); returns how many. */
  pruneBefore(date: string): number {
    return this.db.prepare<[string]>('DELETE FROM suggestion_dismissals WHERE reference_date < ?').run(date).changes;
  }
}
