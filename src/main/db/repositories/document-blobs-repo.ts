import type { Db } from '../driver';

export interface DocumentBlobRow {
  id: string;
  sha256: string;
  relative_path: string;
  size_bytes: number;
  created_at: number;
  unreferenced_since: number | null;
}

const COLUMNS = 'id, sha256, relative_path, size_bytes, created_at, unreferenced_since';
/** A blob is in use while a document (live or trashed) shows it or one of their versions keeps it. */
const REFERENCED = 'id IN (SELECT blob_id FROM documents WHERE blob_id IS NOT NULL) OR id IN (SELECT blob_id FROM document_versions)';

/** Stored document bytes, one row per SHA-256 (D-118). */
export class DocumentBlobsRepo {
  constructor(private readonly db: Db) {}

  get(id: string): DocumentBlobRow | undefined {
    return this.db.prepare<[string], DocumentBlobRow>(`SELECT ${COLUMNS} FROM document_blobs WHERE id = ?`).get(id);
  }

  findBySha(sha256: string): DocumentBlobRow | undefined {
    return this.db.prepare<[string], DocumentBlobRow>(`SELECT ${COLUMNS} FROM document_blobs WHERE sha256 = ?`).get(sha256);
  }

  /** New rows start unreferenced until a document or version uses them. */
  insert(b: { id: string; sha256: string; relativePath: string; sizeBytes: number; now: number }): void {
    this.db
      .prepare<[string, string, string, number, number, number]>(
        'INSERT INTO document_blobs(id, sha256, relative_path, size_bytes, created_at, unreferenced_since) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(b.id, b.sha256, b.relativePath, b.sizeBytes, b.now, b.now);
  }

  /** Every row, for the backup manifest. */
  all(): DocumentBlobRow[] {
    return this.db.prepare<[], DocumentBlobRow>(`SELECT ${COLUMNS} FROM document_blobs ORDER BY id`).all();
  }

  /** Brings every unreferenced clock up to date: referenced rows clear it, others start their grace period now. */
  reconcileReferences(now: number): void {
    this.db.prepare(`UPDATE document_blobs SET unreferenced_since = NULL WHERE unreferenced_since IS NOT NULL AND (${REFERENCED})`).run();
    this.db.prepare<[number]>(`UPDATE document_blobs SET unreferenced_since = ? WHERE unreferenced_since IS NULL AND NOT (${REFERENCED})`).run(now);
  }

  /** Rows unreferenced since `cutoff` or earlier (call reconcileReferences first, in the same transaction). */
  unreferencedSince(cutoff: number): DocumentBlobRow[] {
    return this.db
      .prepare<[number], DocumentBlobRow>(`SELECT ${COLUMNS} FROM document_blobs WHERE unreferenced_since IS NOT NULL AND unreferenced_since <= ?`)
      .all(cutoff);
  }

  deleteRows(ids: readonly string[]): void {
    if (ids.length === 0) return;
    this.db.prepare<[string]>('DELETE FROM document_blobs WHERE id IN (SELECT value FROM json_each(?))').run(JSON.stringify(ids));
  }
}
