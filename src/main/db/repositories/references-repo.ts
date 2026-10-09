import type { Db } from '../driver';

export interface ReferenceInput {
  sourceBlockId: string | null;
  targetNoteId: string;
  targetBlockId: string | null;
  titleSnapshot: string;
}

/** An outgoing reference with what is known about its target (no target columns when the target was purged). */
export interface OutgoingRow {
  target_note_id: string;
  target_block_id: string | null;
  target_title_snapshot: string;
  title: string | null;
  project_id: string | null;
  folder_id: string | null;
  format: 'rich' | 'plain' | null;
  content_json: string | null;
  deleted_at: number | null;
  trash_batch_id: string | null;
  /** 1 when the target note row exists. */
  present: number;
}

export interface BacklinkRow {
  source_note_id: string;
  source_block_id: string | null;
  target_block_id: string | null;
  title: string;
  project_id: string | null;
  folder_id: string | null;
  content_json: string | null;
}

/** The note_references index (D-098): rewritten per source note inside each content write. */
export class ReferencesRepo {
  constructor(private readonly db: Db) {}

  /** Titles of the given notes that still exist (live or in Trash). */
  titles(noteIds: readonly string[]): Map<string, string> {
    if (noteIds.length === 0) return new Map();
    const rows = this.db
      .prepare<[string], { id: string; title: string }>('SELECT id, title FROM notes WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(noteIds));
    return new Map(rows.map((r) => [r.id, r.title]));
  }

  replaceForSource(sourceNoteId: string, refs: readonly ReferenceInput[]): void {
    this.db.prepare<[string]>('DELETE FROM note_references WHERE source_note_id = ?').run(sourceNoteId);
    const insert = this.db.prepare<[string, string | null, string, string | null, string]>(
      'INSERT OR IGNORE INTO note_references(source_note_id, source_block_id, target_note_id, target_block_id, target_title_snapshot) VALUES (?, ?, ?, ?, ?)',
    );
    for (const r of refs) insert.run(sourceNoteId, r.sourceBlockId, r.targetNoteId, r.targetBlockId, r.titleSnapshot);
  }

  /** The source's references in document order, one row per distinct target note and block. */
  outgoing(sourceNoteId: string, limit: number): OutgoingRow[] {
    return this.db
      .prepare<[string, number], OutgoingRow>(
        `SELECT r.target_note_id, r.target_block_id, r.target_title_snapshot,
                n.title, n.project_id, n.folder_id, n.format, n.content_json, n.deleted_at, n.trash_batch_id,
                n.id IS NOT NULL AS present
           FROM note_references r LEFT JOIN notes n ON n.id = r.target_note_id
          WHERE r.source_note_id = ?
          GROUP BY r.target_note_id, ifnull(r.target_block_id, '')
          ORDER BY min(r.id)
          LIMIT ?`,
      )
      .all(sourceNoteId, limit);
  }

  /** Live notes that reference the target (other than the target itself), most recently updated first. */
  backlinks(targetNoteId: string, limit: number): BacklinkRow[] {
    return this.db
      .prepare<[string, string, number], BacklinkRow>(
        `SELECT r.source_note_id, r.source_block_id, r.target_block_id, n.title, n.project_id, n.folder_id, n.content_json
           FROM note_references r JOIN notes n ON n.id = r.source_note_id
          WHERE r.target_note_id = ? AND r.source_note_id <> ? AND n.deleted_at IS NULL
          ORDER BY n.updated_at DESC, r.id
          LIMIT ?`,
      )
      .all(targetNoteId, targetNoteId, limit);
  }
}
