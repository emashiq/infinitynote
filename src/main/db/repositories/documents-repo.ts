import type { HomeScopeType } from '../../../shared/contracts/home';
import type { DocumentKind } from '../../../shared/documents/kinds';
import type { Db } from '../driver';
import { scopeFilter } from './hierarchy-repo';

export interface DocumentRow {
  id: string;
  project_id: string | null;
  folder_id: string | null;
  title: string;
  kind: DocumentKind;
  storage: 'managed' | 'linked';
  blob_id: string | null;
  linked_file_id: string | null;
  source_attachment_id: string | null;
  revision: number;
  size_bytes: number;
  source_modified_at: number | null;
  favorite: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  trash_batch_id: string | null;
}

export const DOCUMENT_COLS =
  'id, project_id, folder_id, title, kind, storage, blob_id, linked_file_id, source_attachment_id, revision, size_bytes, source_modified_at, favorite, created_at, updated_at, deleted_at, trash_batch_id';

export interface DocumentInput {
  id: string;
  projectId: string | null;
  folderId: string | null;
  title: string;
  kind: DocumentKind;
  /** Exactly one of the two: the stored bytes, or the linked original. */
  blobId: string | null;
  linkedFileId: string | null;
  sourceAttachmentId: string | null;
  sizeBytes: number;
  sourceModifiedAt: number | null;
  bodyText: string;
  now: number;
}

/** The bytes a save put in place: a stored blob for a managed document, the rewritten original for a linked one. */
export interface DocumentContentInput {
  id: string;
  blobId: string | null;
  sizeBytes: number;
  sourceModifiedAt: number | null;
  bodyText: string;
  expectedRevision: number;
  now: number;
}

/** Documents (D-118): tree items like notes, with their bytes in document_blobs or a linked file. */
export class DocumentsRepo {
  constructor(private readonly db: Db) {}

  get(id: string): DocumentRow | undefined {
    return this.db.prepare<[string], DocumentRow>(`SELECT ${DOCUMENT_COLS} FROM documents WHERE id = ?`).get(id);
  }

  live(): DocumentRow[] {
    return this.db.prepare<[], DocumentRow>(`SELECT ${DOCUMENT_COLS} FROM documents WHERE deleted_at IS NULL`).all();
  }

  trashed(): DocumentRow[] {
    return this.db.prepare<[], DocumentRow>(`SELECT ${DOCUMENT_COLS} FROM documents WHERE deleted_at IS NOT NULL`).all();
  }

  insert(d: DocumentInput): void {
    this.db
      .prepare<[string, string | null, string | null, string, string, string, string | null, string | null, string | null, number, number | null, string, number, number]>(
        `INSERT INTO documents(id, project_id, folder_id, title, kind, storage, blob_id, linked_file_id, source_attachment_id, size_bytes, source_modified_at, body_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        d.id,
        d.projectId,
        d.folderId,
        d.title,
        d.kind,
        d.blobId !== null ? 'managed' : 'linked',
        d.blobId,
        d.linkedFileId,
        d.sourceAttachmentId,
        d.sizeBytes,
        d.sourceModifiedAt,
        d.bodyText,
        d.now,
        d.now,
      );
  }

  rename(id: string, title: string, now: number): void {
    this.db.prepare<[string, number, string]>('UPDATE documents SET title = ?, updated_at = ? WHERE id = ?').run(title, now, id);
  }

  move(id: string, projectId: string | null, folderId: string | null): void {
    this.db.prepare<[string | null, string | null, string]>('UPDATE documents SET project_id = ?, folder_id = ? WHERE id = ?').run(projectId, folderId, id);
  }

  setFavorite(id: string, favorite: boolean): void {
    this.db.prepare<[number, string]>('UPDATE documents SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, id);
  }

  /** Records new content as the next revision. Returns false when the revision moved on. */
  writeContent(c: DocumentContentInput): boolean {
    return (
      this.db
        .prepare<[string | null, number, number | null, string, number, string, number]>(
          `UPDATE documents SET blob_id = COALESCE(?, blob_id), size_bytes = ?, source_modified_at = ?, body_text = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(c.blobId, c.sizeBytes, c.sourceModifiedAt, c.bodyText, c.now, c.id, c.expectedRevision).changes === 1
    );
  }

  /** A linked original changed outside the app: its size and text follow it, without a new revision. */
  refreshLinked(id: string, sizeBytes: number, sourceModifiedAt: number, bodyText: string): void {
    this.db
      .prepare<[number, number, string, string]>('UPDATE documents SET size_bytes = ?, source_modified_at = ?, body_text = ? WHERE id = ?')
      .run(sizeBytes, sourceModifiedAt, bodyText, id);
  }

  /** The live document an earlier "Open in Infinity Notes" made from this attachment or linked file. */
  liveFromAttachment(attachmentId: string): DocumentRow | undefined {
    return this.db
      .prepare<[string], DocumentRow>(`SELECT ${DOCUMENT_COLS} FROM documents WHERE source_attachment_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1`)
      .get(attachmentId);
  }

  liveFromLink(linkId: string): DocumentRow | undefined {
    return this.db
      .prepare<[string], DocumentRow>(`SELECT ${DOCUMENT_COLS} FROM documents WHERE linked_file_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1`)
      .get(linkId);
  }

  /** Live documents in the scope, most recently updated first (Home). */
  recent(scope: HomeScopeType, limit: number): DocumentRow[] {
    const { where, args } = scopeFilter(scope);
    return this.db
      .prepare<string[], DocumentRow>(`SELECT ${DOCUMENT_COLS} FROM documents WHERE deleted_at IS NULL${where} ORDER BY updated_at DESC, id LIMIT ${limit}`)
      .all(...args);
  }

  /** 'live' or 'trashed' for each of the ids that still exists. */
  states(ids: readonly string[]): Map<string, 'live' | 'trashed'> {
    const rows = this.db
      .prepare<[string], { id: string; deleted_at: number | null }>('SELECT id, deleted_at FROM documents WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(ids));
    return new Map(rows.map((r) => [r.id, r.deleted_at === null ? 'live' : 'trashed']));
  }
}
