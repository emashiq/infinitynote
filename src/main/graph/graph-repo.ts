import type { GraphScopeType } from '../../shared/contracts/graph';
import type { DocumentKind } from '../../shared/documents/kinds';
import type { Db } from '../db/driver';

export interface GraphNoteRow {
  id: string;
  title: string;
  project_id: string | null;
  folder_id: string | null;
  locked: number;
}

export interface GraphDocumentRow {
  id: string;
  title: string;
  kind: DocumentKind;
  project_id: string | null;
  folder_id: string | null;
}

export interface GraphLinkRow {
  source_id: string;
  target_id: string;
}

/** The scope condition on an item alias `x` (a folder scope covers its whole subtree). */
function scopeSql(scope: GraphScopeType): { where: string; args: string[] } {
  switch (scope.kind) {
    case 'all':
      return { where: '', args: [] };
    case 'common':
      return { where: ' AND x.project_id IS NULL', args: [] };
    case 'project':
      return { where: ' AND x.project_id = ?', args: [scope.projectId] };
    case 'folder':
      return {
        where: ` AND x.folder_id IN (WITH RECURSIVE sub(id) AS (SELECT id FROM folders WHERE id = ? AND deleted_at IS NULL
                   UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id WHERE f.deleted_at IS NULL) SELECT id FROM sub)`,
        args: [scope.folderId],
      };
  }
}

/**
 * The reads behind the relation graph (D-170): live items in a scope and every link between live items. Each read is
 * one statement; links name both ends by ID, and the model keeps only links whose ends it holds.
 */
export class GraphRepo {
  constructor(private readonly db: Db) {}

  notes(scope: GraphScopeType, tag: string | null): GraphNoteRow[] {
    const { where, args } = scopeSql(scope);
    const tagSql = tag === null ? '' : ' AND x.id IN (SELECT nt.note_id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE t.name = ?)';
    return this.db
      .prepare<string[], GraphNoteRow>(
        `SELECT x.id, x.title, x.project_id, x.folder_id, x.locked FROM notes x WHERE x.deleted_at IS NULL${where}${tagSql} ORDER BY x.updated_at DESC`,
      )
      .all(...args, ...(tag === null ? [] : [tag]));
  }

  documents(scope: GraphScopeType): GraphDocumentRow[] {
    const { where, args } = scopeSql(scope);
    return this.db
      .prepare<string[], GraphDocumentRow>(`SELECT x.id, x.title, x.kind, x.project_id, x.folder_id FROM documents x WHERE x.deleted_at IS NULL${where} ORDER BY x.updated_at DESC`)
      .all(...args);
  }

  /** Links from live notes to other live notes. */
  noteLinks(): GraphLinkRow[] {
    return this.db
      .prepare<[], GraphLinkRow>(
        `SELECT DISTINCT r.source_note_id AS source_id, r.target_note_id AS target_id
           FROM note_references r
           JOIN notes a ON a.id = r.source_note_id AND a.deleted_at IS NULL
           JOIN notes b ON b.id = r.target_note_id AND b.deleted_at IS NULL
          WHERE r.source_note_id <> r.target_note_id`,
      )
      .all();
  }

  /** Links from live notes to live documents (D-156). */
  documentLinks(): GraphLinkRow[] {
    return this.db
      .prepare<[], GraphLinkRow>(
        `SELECT DISTINCT r.source_note_id AS source_id, r.target_document_id AS target_id
           FROM document_references r
           JOIN notes a ON a.id = r.source_note_id AND a.deleted_at IS NULL
           JOIN documents d ON d.id = r.target_document_id AND d.deleted_at IS NULL`,
      )
      .all();
  }

  /** Live documents opened in the app from a live note's attached or linked file (D-118). */
  fileLinks(): GraphLinkRow[] {
    return this.db
      .prepare<[], GraphLinkRow>(
        `SELECT na.note_id AS source_id, d.id AS target_id
           FROM note_attachments na
           JOIN notes a ON a.id = na.note_id AND a.deleted_at IS NULL
           JOIN documents d ON d.source_attachment_id = na.attachment_id AND d.deleted_at IS NULL
         UNION
         SELECT nl.note_id, d.id
           FROM note_linked_files nl
           JOIN notes a ON a.id = nl.note_id AND a.deleted_at IS NULL
           JOIN documents d ON d.linked_file_id = nl.link_id AND d.deleted_at IS NULL`,
      )
      .all();
  }
}
