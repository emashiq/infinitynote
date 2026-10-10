import type { DocumentKind } from '../../../shared/documents/kinds';
import type { Db } from '../driver';

export interface DocumentReferenceInput {
  sourceBlockId: string | null;
  targetDocumentId: string;
  /** The place inside the document as JSON, '' for the whole document. */
  targetJson: string;
  titleSnapshot: string;
}

/** An outgoing document link with what is known about its target (no target columns when the document was purged). */
export interface DocumentOutgoingRow {
  target_document_id: string;
  target_json: string;
  target_title_snapshot: string;
  title: string | null;
  kind: DocumentKind | null;
  project_id: string | null;
  folder_id: string | null;
  deleted_at: number | null;
  trash_batch_id: string | null;
  present: number;
}

/** A live note linking to a document. */
export interface DocumentBacklinkRow {
  source_note_id: string;
  source_block_id: string | null;
  target_json: string;
  title: string;
  project_id: string | null;
  folder_id: string | null;
  content_json: string | null;
}

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
  /** 1 when the target is locked: its blocks cannot be read (D-111). */
  locked: number | null;
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

/** The note_references (D-098) and document_references (D-156) indexes: rewritten per source note inside each content write. */
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
                n.title, n.project_id, n.folder_id, n.format, n.content_json, n.locked, n.deleted_at, n.trash_batch_id,
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

  /** Titles of the given documents that still exist (live or in Trash). */
  documentTitles(documentIds: readonly string[]): Map<string, string> {
    if (documentIds.length === 0) return new Map();
    const rows = this.db
      .prepare<[string], { id: string; title: string }>('SELECT id, title FROM documents WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(documentIds));
    return new Map(rows.map((r) => [r.id, r.title]));
  }

  replaceDocumentRefsForSource(sourceNoteId: string, refs: readonly DocumentReferenceInput[]): void {
    this.db.prepare<[string]>('DELETE FROM document_references WHERE source_note_id = ?').run(sourceNoteId);
    const insert = this.db.prepare<[string, string | null, string, string, string]>(
      'INSERT OR IGNORE INTO document_references(source_note_id, source_block_id, target_document_id, target_json, target_title_snapshot) VALUES (?, ?, ?, ?, ?)',
    );
    for (const r of refs) insert.run(sourceNoteId, r.sourceBlockId, r.targetDocumentId, r.targetJson, r.titleSnapshot);
  }

  /** The source's document links in document order, one row per distinct document and place. */
  documentOutgoing(sourceNoteId: string, limit: number): DocumentOutgoingRow[] {
    return this.db
      .prepare<[string, number], DocumentOutgoingRow>(
        `SELECT r.target_document_id, r.target_json, r.target_title_snapshot,
                d.title, d.kind, d.project_id, d.folder_id, d.deleted_at, d.trash_batch_id, d.id IS NOT NULL AS present
           FROM document_references r LEFT JOIN documents d ON d.id = r.target_document_id
          WHERE r.source_note_id = ?
          GROUP BY r.target_document_id, r.target_json
          ORDER BY min(r.id)
          LIMIT ?`,
      )
      .all(sourceNoteId, limit);
  }

  /** Live notes that link to the document, most recently updated first. */
  documentBacklinks(targetDocumentId: string, limit: number): DocumentBacklinkRow[] {
    return this.db
      .prepare<[string, number], DocumentBacklinkRow>(
        `SELECT r.source_note_id, r.source_block_id, r.target_json, n.title, n.project_id, n.folder_id, n.content_json
           FROM document_references r JOIN notes n ON n.id = r.source_note_id
          WHERE r.target_document_id = ? AND n.deleted_at IS NULL
          ORDER BY n.updated_at DESC, r.id
          LIMIT ?`,
      )
      .all(targetDocumentId, limit);
  }
}
