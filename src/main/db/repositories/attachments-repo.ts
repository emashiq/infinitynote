import type { AttachmentRef } from '../../../shared/editor/doc-schema';
import type { Db } from '../driver';

export interface AttachmentRow {
  id: string;
  managed_relative_path: string;
  sha256: string;
  mime: string;
  size_bytes: number;
  original_name: string | null;
  kind: 'image' | 'document';
  created_at: number;
  unreferenced_since: number | null;
}

export interface AttachmentInput {
  id: string;
  relativePath: string;
  sha256: string;
  mime: string;
  sizeBytes: number;
  originalName: string | null;
  kind: 'image' | 'document';
  now: number;
}

const COLUMNS = 'id, managed_relative_path, sha256, mime, size_bytes, original_name, kind, created_at, unreferenced_since';

/** Managed attachment files (attachments) and the notes that reference them (note_attachments). */
export class AttachmentsRepo {
  constructor(private readonly db: Db) {}

  get(id: string): AttachmentRow | undefined {
    return this.db.prepare<[string], AttachmentRow>(`SELECT ${COLUMNS} FROM attachments WHERE id = ?`).get(id);
  }

  findBySha(sha256: string): AttachmentRow | undefined {
    return this.db.prepare<[string], AttachmentRow>(`SELECT ${COLUMNS} FROM attachments WHERE sha256 = ?`).get(sha256);
  }

  /** New rows start unreferenced until a note save links them. */
  insert(a: AttachmentInput): void {
    this.db
      .prepare<[string, string, string, string, number, string | null, string, number, number]>(
        'INSERT INTO attachments(id, managed_relative_path, sha256, mime, size_bytes, original_name, kind, created_at, unreferenced_since) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(a.id, a.relativePath, a.sha256, a.mime, a.sizeBytes, a.originalName, a.kind, a.now, a.now);
  }

  promoteToImage(id: string, mime: string): void {
    this.db.prepare<[string, string]>("UPDATE attachments SET kind = 'image', mime = ? WHERE id = ?").run(mime, id);
  }

  /** The subset of ids that exist. */
  existingIds(ids: readonly string[]): Set<string> {
    if (ids.length === 0) return new Set();
    const rows = this.db
      .prepare<[string], { id: string }>('SELECT id FROM attachments WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(ids));
    return new Set(rows.map((r) => r.id));
  }

  linkedIds(noteId: string): string[] {
    return this.db
      .prepare<[string], { attachment_id: string }>('SELECT DISTINCT attachment_id FROM note_attachments WHERE note_id = ?')
      .all(noteId)
      .map((r) => r.attachment_id);
  }

  hasLinks(noteId: string): boolean {
    return this.db.prepare<[string], { found: number }>('SELECT 1 AS found FROM note_attachments WHERE note_id = ? LIMIT 1').get(noteId) !== undefined;
  }

  replaceLinks(noteId: string, refs: readonly AttachmentRef[]): void {
    this.db.prepare<[string]>('DELETE FROM note_attachments WHERE note_id = ?').run(noteId);
    const insert = this.db.prepare<[string, string, string | null]>('INSERT INTO note_attachments(note_id, attachment_id, block_id) VALUES (?, ?, ?)');
    for (const ref of refs) insert.run(noteId, ref.attachmentId, ref.blockId);
  }

  markReferenced(ids: readonly string[]): void {
    if (ids.length === 0) return;
    this.db
      .prepare<[string]>('UPDATE attachments SET unreferenced_since = NULL WHERE id IN (SELECT value FROM json_each(?)) AND unreferenced_since IS NOT NULL')
      .run(JSON.stringify(ids));
  }

  /** Starts the unreferenced clock for each id that no note links any more. */
  markUnreferencedIfOrphaned(ids: readonly string[], now: number): void {
    if (ids.length === 0) return;
    this.db
      .prepare<[number, string]>(
        `UPDATE attachments SET unreferenced_since = ?
         WHERE id IN (SELECT value FROM json_each(?)) AND unreferenced_since IS NULL
           AND NOT EXISTS (SELECT 1 FROM note_attachments WHERE attachment_id = attachments.id)`,
      )
      .run(now, JSON.stringify(ids));
  }
}
