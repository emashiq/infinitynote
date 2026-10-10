import type { Db } from '../driver';

export interface LinkedFileRow {
  id: string;
  path: string;
  name: string;
  size_bytes: number;
  created_at: number;
  unreferenced_since: number | null;
}

export interface LinkedFileInput {
  id: string;
  path: string;
  name: string;
  sizeBytes: number;
  now: number;
}

const COLUMNS = 'id, path, name, size_bytes, created_at, unreferenced_since';
const json = (ids: readonly string[]): string => JSON.stringify(ids);

/** Files linked at their original location (linked_files) and the notes that use them (note_linked_files), D-108. */
export class LinkedFilesRepo {
  constructor(private readonly db: Db) {}

  get(id: string): LinkedFileRow | undefined {
    return this.db.prepare<[string], LinkedFileRow>(`SELECT ${COLUMNS} FROM linked_files WHERE id = ?`).get(id);
  }

  /** New rows start unreferenced until a note save uses them. */
  insert(l: LinkedFileInput): void {
    this.db
      .prepare<[string, string, string, number, number, number]>(
        'INSERT INTO linked_files(id, path, name, size_bytes, created_at, unreferenced_since) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(l.id, l.path, l.name, l.sizeBytes, l.now, l.now);
  }

  /** The subset of ids that exist. */
  existingIds(ids: readonly string[]): Set<string> {
    if (ids.length === 0) return new Set();
    const rows = this.db.prepare<[string], { id: string }>('SELECT id FROM linked_files WHERE id IN (SELECT value FROM json_each(?))').all(json(ids));
    return new Set(rows.map((r) => r.id));
  }

  /** A linked document was saved back to the file (D-118). */
  setSize(id: string, sizeBytes: number): void {
    this.db.prepare<[number, string]>('UPDATE linked_files SET size_bytes = ? WHERE id = ?').run(sizeBytes, id);
  }

  isUsedBy(noteId: string, linkId: string): boolean {
    return this.db.prepare<[string, string], { found: number }>('SELECT 1 AS found FROM note_linked_files WHERE note_id = ? AND link_id = ?').get(noteId, linkId) !== undefined;
  }

  /** Records the links a note's saved content uses; links it stopped using start their unreferenced clock. */
  replaceForNote(noteId: string, linkIds: readonly string[], now: number): void {
    const before = this.db
      .prepare<[string], { link_id: string }>('SELECT link_id FROM note_linked_files WHERE note_id = ?')
      .all(noteId)
      .map((r) => r.link_id);
    this.db.prepare<[string]>('DELETE FROM note_linked_files WHERE note_id = ?').run(noteId);
    const insert = this.db.prepare<[string, string]>('INSERT INTO note_linked_files(note_id, link_id) VALUES (?, ?)');
    for (const id of linkIds) insert.run(noteId, id);
    this.db.prepare<[string]>('UPDATE linked_files SET unreferenced_since = NULL WHERE id IN (SELECT value FROM json_each(?))').run(json(linkIds));
    const dropped = before.filter((id) => !linkIds.includes(id));
    this.db
      .prepare<[number, string]>(
        `UPDATE linked_files SET unreferenced_since = ?
         WHERE id IN (SELECT value FROM json_each(?)) AND unreferenced_since IS NULL
           AND NOT EXISTS (SELECT 1 FROM note_linked_files WHERE link_id = linked_files.id)`,
      )
      .run(now, json(dropped));
  }

  /** Links used by live notes that are not locked, or by live documents (the portable export's). */
  usedByExportableItems(): LinkedFileRow[] {
    return this.db
      .prepare<[], LinkedFileRow>(
        `SELECT ${COLUMNS} FROM linked_files l
         WHERE EXISTS (SELECT 1 FROM note_linked_files nl JOIN notes n ON n.id = nl.note_id AND n.deleted_at IS NULL AND n.locked = 0 WHERE nl.link_id = l.id)
            OR EXISTS (SELECT 1 FROM documents d WHERE d.linked_file_id = l.id AND d.deleted_at IS NULL)
         ORDER BY l.id`,
      )
      .all();
  }

  /**
   * Garbage collection (INF-PORT-08): brings every unreferenced clock up to date and deletes the rows unreferenced since
   * `cutoff`. A link is referenced while a note (live or trashed) uses it, a document (live or trashed) is its file, or a
   * version or an open draft names its ID.
   */
  deleteUnreferencedSince(cutoff: number, now: number): number {
    const referenced = `id IN (SELECT link_id FROM note_linked_files)
      OR id IN (SELECT linked_file_id FROM documents WHERE linked_file_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM note_versions v WHERE instr(v.content_snapshot, linked_files.id) > 0)
      OR EXISTS (SELECT 1 FROM note_drafts d WHERE d.resolved_at IS NULL AND instr(d.content, linked_files.id) > 0)`;
    this.db.prepare(`UPDATE linked_files SET unreferenced_since = NULL WHERE unreferenced_since IS NOT NULL AND (${referenced})`).run();
    this.db.prepare<[number]>(`UPDATE linked_files SET unreferenced_since = ? WHERE unreferenced_since IS NULL AND NOT (${referenced})`).run(now);
    return this.db.prepare<[number]>('DELETE FROM linked_files WHERE unreferenced_since IS NOT NULL AND unreferenced_since <= ?').run(cutoff).changes;
  }
}
