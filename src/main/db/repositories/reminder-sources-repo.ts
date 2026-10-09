import type { SourceStateType } from '../../../shared/contracts/reminders';
import type { Db } from '../driver';

export interface ReminderSourceRow {
  reminder_id: string;
  note_id: string;
  /** Null for plain-text notes (note-level sources). */
  block_id: string | null;
  source_text: string;
  span_start: number | null;
  span_end: number | null;
  span_ordinal: number;
  reference_instant_utc: number;
  reference_zone: string;
  parser_version: number;
  origin: 'suggestion' | 'selection';
  source_state: SourceStateType;
  created_at: number;
  updated_at: number;
}

export type SourceFields = Omit<ReminderSourceRow, 'reminder_id' | 'note_id' | 'source_state' | 'created_at' | 'updated_at'>;

const COLS =
  'reminder_id, note_id, block_id, source_text, span_start, span_end, span_ordinal, reference_instant_utc, reference_zone, parser_version, origin, source_state, created_at, updated_at';
const S_COLS = COLS.split(', ')
  .map((c) => `s.${c}`)
  .join(', ');

/** SQL of `reminder_sources` (migration 006, D-088). Callers own the transactions. */
export class ReminderSourcesRepo {
  constructor(private readonly db: Db) {}

  get(reminderId: string): ReminderSourceRow | undefined {
    return this.db.prepare<[string], ReminderSourceRow>(`SELECT ${COLS} FROM reminder_sources WHERE reminder_id = ?`).get(reminderId);
  }

  forReminders(reminderIds: readonly string[]): Map<string, ReminderSourceRow> {
    const rows = this.db
      .prepare<[string], ReminderSourceRow>(`SELECT ${COLS} FROM reminder_sources WHERE reminder_id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(reminderIds));
    return new Map(rows.map((r) => [r.reminder_id, r]));
  }

  /** A new source in state `ok`. */
  insert(reminderId: string, noteId: string, fields: SourceFields, now: number): void {
    this.db
      .prepare(
        `INSERT INTO reminder_sources(${COLS})
         VALUES (@reminder_id, @note_id, @block_id, @source_text, @span_start, @span_end, @span_ordinal, @reference_instant_utc, @reference_zone,
           @parser_version, @origin, 'ok', @now, @now)`,
      )
      .run({ ...fields, reminder_id: reminderId, note_id: noteId, now });
  }

  /** Replaces a reminder's source with a newly read phrase (state `ok`), or adds one when it had none. */
  replace(reminderId: string, noteId: string, fields: SourceFields, now: number): void {
    this.db
      .prepare(
        `INSERT INTO reminder_sources(${COLS})
         VALUES (@reminder_id, @note_id, @block_id, @source_text, @span_start, @span_end, @span_ordinal, @reference_instant_utc, @reference_zone,
           @parser_version, @origin, 'ok', @now, @now)
         ON CONFLICT(reminder_id) DO UPDATE SET block_id = excluded.block_id, source_text = excluded.source_text, span_start = excluded.span_start,
           span_end = excluded.span_end, span_ordinal = excluded.span_ordinal, reference_instant_utc = excluded.reference_instant_utc,
           reference_zone = excluded.reference_zone, parser_version = excluded.parser_version, origin = excluded.origin, source_state = 'ok',
           updated_at = excluded.updated_at`,
      )
      .run({ ...fields, reminder_id: reminderId, note_id: noteId, now });
  }

  setState(reminderId: string, state: SourceStateType, now: number): void {
    this.db.prepare<[string, number, string]>('UPDATE reminder_sources SET source_state = ?, updated_at = ? WHERE reminder_id = ?').run(state, now, reminderId);
  }

  /** Sources of the note's live reminders that still follow the text (not detached), for the source-state sync. */
  trackedForNote(noteId: string): ReminderSourceRow[] {
    return this.db
      .prepare<[string], ReminderSourceRow>(
        `SELECT ${S_COLS} FROM reminder_sources s JOIN reminders r ON r.id = s.reminder_id
         WHERE s.note_id = ? AND s.source_state <> 'detached' AND r.deleted_at IS NULL`,
      )
      .all(noteId);
  }

  /**
   * Linked sources of live reminders at the same place: same note, block (or none) and ordinal, not detached. The
   * caller compares the normalized text (SQLite has no Unicode normalization).
   */
  linksAt(noteId: string, blockId: string | null, spanOrdinal: number): ReminderSourceRow[] {
    return this.db
      .prepare<[string, string | null, number], ReminderSourceRow>(
        `SELECT ${S_COLS} FROM reminder_sources s JOIN reminders r ON r.id = s.reminder_id
         WHERE s.note_id = ? AND s.block_id IS ? AND s.span_ordinal = ? AND s.source_state <> 'detached' AND r.deleted_at IS NULL
         ORDER BY s.created_at, s.reminder_id`,
      )
      .all(noteId, blockId, spanOrdinal);
  }
}
