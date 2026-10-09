import type { Db } from '../driver';

export type VersionReason = 'auto' | 'conversion' | 'conflict' | 'restore' | 'import';

export interface VersionRow {
  id: string;
  note_id: string;
  revision: number;
  format: 'rich' | 'plain';
  content_snapshot: string;
  attachment_ids: string;
  reason: VersionReason;
  created_at: number;
}

export interface VersionInput {
  id: string;
  noteId: string;
  revision: number;
  format: 'rich' | 'plain';
  content: string;
  attachmentIds: string[];
  reason: VersionReason;
  now: number;
}

const COLUMNS = 'id, note_id, revision, format, content_snapshot, attachment_ids, reason, created_at';

/** Saved copies of earlier note content (note_versions, D-056). */
export class VersionsRepo {
  constructor(private readonly db: Db) {}

  insert(v: VersionInput): void {
    this.db
      .prepare<[string, string, number, string, string, string, string, number]>(
        'INSERT INTO note_versions(id, note_id, revision, format, content_snapshot, attachment_ids, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(v.id, v.noteId, v.revision, v.format, v.content, JSON.stringify(v.attachmentIds), v.reason, v.now);
  }

  /** Newest first. */
  list(noteId: string, limit: number): VersionRow[] {
    return this.db
      .prepare<[string, number], VersionRow>(`SELECT ${COLUMNS} FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(noteId, limit);
  }

  get(noteId: string, versionId: string): VersionRow | undefined {
    return this.db.prepare<[string, string], VersionRow>(`SELECT ${COLUMNS} FROM note_versions WHERE id = ? AND note_id = ?`).get(versionId, noteId);
  }

  hasAutoSince(noteId: string, since: number): boolean {
    const row = this.db
      .prepare<[string, number], { found: number }>("SELECT 1 AS found FROM note_versions WHERE note_id = ? AND reason = 'auto' AND created_at > ? LIMIT 1")
      .get(noteId, since);
    return row !== undefined;
  }

  autoVersions(noteId: string): Array<{ id: string; createdAt: number }> {
    return this.db
      .prepare<[string], { id: string; createdAt: number }>("SELECT id, created_at AS createdAt FROM note_versions WHERE note_id = ? AND reason = 'auto'")
      .all(noteId);
  }

  notesWithAutoVersions(): string[] {
    return this.db
      .prepare<[], { note_id: string }>("SELECT DISTINCT note_id FROM note_versions WHERE reason = 'auto'")
      .all()
      .map((r) => r.note_id);
  }

  /** Attachment IDs that any saved version still uses. */
  referencedAttachmentIds(): string[] {
    return this.db
      .prepare<[], { id: string }>('SELECT DISTINCT j.value AS id FROM note_versions v, json_each(v.attachment_ids) j')
      .all()
      .map((r) => r.id);
  }

  deleteIds(ids: readonly string[]): void {
    if (ids.length === 0) return;
    this.db.prepare<[string]>('DELETE FROM note_versions WHERE id IN (SELECT value FROM json_each(?))').run(JSON.stringify(ids));
  }
}
