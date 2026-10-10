import type { Db } from '../driver';

export type DocumentVersionReason = 'save' | 'restore';

export interface DocumentVersionRow {
  id: string;
  document_id: string;
  revision: number;
  blob_id: string;
  reason: DocumentVersionReason;
  size_bytes: number;
  created_at: number;
}

const SELECT =
  'SELECT v.id, v.document_id, v.revision, v.blob_id, v.reason, b.size_bytes, v.created_at FROM document_versions v JOIN document_blobs b ON b.id = v.blob_id';

/** Earlier bytes of a document (D-118): each points at a stored blob. */
export class DocumentVersionsRepo {
  constructor(private readonly db: Db) {}

  insert(v: { id: string; documentId: string; revision: number; blobId: string; reason: DocumentVersionReason; now: number }): void {
    this.db
      .prepare<[string, string, number, string, string, number]>(
        'INSERT INTO document_versions(id, document_id, revision, blob_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(v.id, v.documentId, v.revision, v.blobId, v.reason, v.now);
  }

  /** Newest first, with the size of each version's bytes. */
  list(documentId: string): DocumentVersionRow[] {
    return this.db.prepare<[string], DocumentVersionRow>(`${SELECT} WHERE v.document_id = ? ORDER BY v.created_at DESC, v.revision DESC`).all(documentId);
  }

  get(documentId: string, versionId: string): DocumentVersionRow | undefined {
    return this.db.prepare<[string, string], DocumentVersionRow>(`${SELECT} WHERE v.document_id = ? AND v.id = ?`).get(documentId, versionId);
  }

  documentsWithVersions(): string[] {
    return this.db
      .prepare<[], { document_id: string }>('SELECT DISTINCT document_id FROM document_versions')
      .all()
      .map((r) => r.document_id);
  }

  deleteIds(ids: readonly string[]): void {
    if (ids.length === 0) return;
    this.db.prepare<[string]>('DELETE FROM document_versions WHERE id IN (SELECT value FROM json_each(?))').run(JSON.stringify(ids));
  }
}
