import type { Db } from '../driver';
import { DocumentBlobsRepo } from './document-blobs-repo';
import { DOCUMENT_COLS, type DocumentRow } from './documents-repo';
import { NOTE_META_COLS, type NoteMetaRow } from './hierarchy-repo';

type TrashTable = 'projects' | 'folders' | 'notes' | 'documents';

const TRASH_TABLES: readonly TrashTable[] = ['projects', 'folders', 'notes', 'documents'];
const json = (ids: readonly string[]): string => JSON.stringify(ids);
/** Folder deletion runs leaf-first in rounds; the depth limit keeps the number of rounds small. */
const MAX_DELETE_ROUNDS = 40;

/** SQL for soft-deleting, restoring and purging trash batches (D-046). Callers run it inside a transaction. */
export class TrashRepo {
  constructor(private readonly db: Db) {}

  // Trash ----------------------------------------------------------------------
  markNotes(ids: readonly string[], batch: string, now: number): void {
    this.db
      .prepare<[number, string, string]>('UPDATE notes SET deleted_at = ?, trash_batch_id = ? WHERE id IN (SELECT value FROM json_each(?))')
      .run(now, batch, json(ids));
  }

  markDocuments(ids: readonly string[], batch: string, now: number): void {
    this.db
      .prepare<[number, string, string]>('UPDATE documents SET deleted_at = ?, trash_batch_id = ? WHERE id IN (SELECT value FROM json_each(?))')
      .run(now, batch, json(ids));
  }

  markFolders(ids: readonly string[], batch: string, now: number): void {
    this.db
      .prepare<[number, string, string]>('UPDATE folders SET deleted_at = ?, trash_batch_id = ? WHERE id IN (SELECT value FROM json_each(?))')
      .run(now, batch, json(ids));
  }

  /** Soft-deletes the live folders of a project; returns how many were marked. */
  markProjectFolders(projectId: string, batch: string, now: number): number {
    return this.db
      .prepare<[number, string, string]>('UPDATE folders SET deleted_at = ?, trash_batch_id = ? WHERE project_id = ? AND deleted_at IS NULL')
      .run(now, batch, projectId).changes;
  }

  markProject(projectId: string, batch: string, now: number): void {
    this.db.prepare<[number, string, string]>('UPDATE projects SET deleted_at = ?, trash_batch_id = ? WHERE id = ?').run(now, batch, projectId);
  }

  liveFolderIds(ids: readonly string[]): string[] {
    return this.ids('SELECT id FROM folders WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL', json(ids));
  }

  liveNoteIdsInFolders(folderIds: readonly string[]): string[] {
    return this.ids('SELECT id FROM notes WHERE folder_id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL', json(folderIds));
  }

  liveNoteIdsInProject(projectId: string): string[] {
    return this.ids('SELECT id FROM notes WHERE project_id = ? AND deleted_at IS NULL', projectId);
  }

  liveDocumentIdsInFolders(folderIds: readonly string[]): string[] {
    return this.ids('SELECT id FROM documents WHERE folder_id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL', json(folderIds));
  }

  liveDocumentIdsInProject(projectId: string): string[] {
    return this.ids('SELECT id FROM documents WHERE project_id = ? AND deleted_at IS NULL', projectId);
  }

  // Restore --------------------------------------------------------------------
  isReanchored(batch: string): boolean {
    return this.db.prepare<[string], { batch_id: string }>('SELECT batch_id FROM trash_reanchored WHERE batch_id = ?').get(batch) !== undefined;
  }

  noteIdsInBatch(batch: string): string[] {
    return this.ids('SELECT id FROM notes WHERE trash_batch_id = ?', batch);
  }

  documentIdsInBatch(batch: string): string[] {
    return this.ids('SELECT id FROM documents WHERE trash_batch_id = ?', batch);
  }

  /** Makes every row of the batch live again and forgets its re-anchored flag. */
  restoreBatch(batch: string): void {
    for (const table of TRASH_TABLES) {
      this.db.prepare<[string]>(`UPDATE ${table} SET deleted_at = NULL, trash_batch_id = NULL WHERE trash_batch_id = ?`).run(batch);
    }
    this.db.prepare<[string]>('DELETE FROM trash_reanchored WHERE batch_id = ?').run(batch);
  }

  // Purge ----------------------------------------------------------------------
  /** Every batch that still has a trashed row; with `deletedBefore`, only batches trashed before that time. */
  batchIds(deletedBefore = Number.MAX_SAFE_INTEGER): string[] {
    const batches = new Set<string>();
    for (const table of TRASH_TABLES) {
      const rows = this.db
        .prepare<[number], { b: string }>(
          `SELECT DISTINCT trash_batch_id AS b FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ? AND trash_batch_id IS NOT NULL`,
        )
        .all(deletedBefore);
      for (const r of rows) batches.add(r.b);
    }
    return [...batches];
  }

  idsInBatches(table: TrashTable, batches: readonly string[]): string[] {
    return this.ids(`SELECT id FROM ${table} WHERE trash_batch_id IN (SELECT value FROM json_each(?))`, json(batches));
  }

  /** Notes (live or trashed) located in one of the folders or projects. */
  notesIn(folderIds: readonly string[], projectIds: readonly string[]): NoteMetaRow[] {
    return this.db
      .prepare<[string, string], NoteMetaRow>(
        `SELECT ${NOTE_META_COLS} FROM notes WHERE folder_id IN (SELECT value FROM json_each(?)) OR project_id IN (SELECT value FROM json_each(?))`,
      )
      .all(json(folderIds), json(projectIds));
  }

  /** Documents (live or trashed) located in one of the folders or projects. */
  documentsIn(folderIds: readonly string[], projectIds: readonly string[]): DocumentRow[] {
    return this.db
      .prepare<[string, string], DocumentRow>(
        `SELECT ${DOCUMENT_COLS} FROM documents WHERE folder_id IN (SELECT value FROM json_each(?)) OR project_id IN (SELECT value FROM json_each(?))`,
      )
      .all(json(folderIds), json(projectIds));
  }

  setDocumentLocation(documentId: string, projectId: string | null, folderId: string | null): void {
    this.db.prepare<[string | null, string | null, string]>('UPDATE documents SET folder_id = ?, project_id = ? WHERE id = ?').run(folderId, projectId, documentId);
  }

  setFolderLocation(folderId: string, projectId: string | null, parentId: string | null): void {
    this.db.prepare<[string | null, string | null, string]>('UPDATE folders SET parent_id = ?, project_id = ? WHERE id = ?').run(parentId, projectId, folderId);
  }

  setNoteLocation(noteId: string, projectId: string | null, folderId: string | null): void {
    this.db.prepare<[string | null, string | null, string]>('UPDATE notes SET folder_id = ?, project_id = ? WHERE id = ?').run(folderId, projectId, noteId);
  }

  /** Records that a surviving batch lost its original parent, so a later restore reports it as relocated. */
  markReanchored(batch: string): void {
    this.db.prepare<[string]>('INSERT OR IGNORE INTO trash_reanchored(batch_id) VALUES (?)').run(batch);
  }

  /** Deletes the purged rows (folders leaf-first) and the batches' re-anchored flags. */
  deletePurged(
    batches: readonly string[],
    ids: { projects: readonly string[]; folders: readonly string[]; notes: readonly string[]; documents: readonly string[] },
  ): void {
    this.db.prepare<[string]>('DELETE FROM trash_reanchored WHERE batch_id IN (SELECT value FROM json_each(?))').run(json(batches));
    this.db.prepare<[string]>('DELETE FROM notes WHERE id IN (SELECT value FROM json_each(?))').run(json(ids.notes));
    this.db.prepare<[string]>('DELETE FROM documents WHERE id IN (SELECT value FROM json_each(?))').run(json(ids.documents));
    const deleteLeafFolders = this.db.prepare<[string]>(
      'DELETE FROM folders WHERE id IN (SELECT value FROM json_each(?)) AND NOT EXISTS (SELECT 1 FROM folders c WHERE c.parent_id = folders.id)',
    );
    for (let round = 0; round < MAX_DELETE_ROUNDS; round += 1) {
      if (deleteLeafFolders.run(json(ids.folders)).changes === 0) break;
    }
    this.db.prepare<[string]>('DELETE FROM projects WHERE id IN (SELECT value FROM json_each(?))').run(json(ids.projects));
  }

  /** Starts the GC grace period for attachments that no note references, and document blobs no document uses, any more. */
  markUnreferencedFiles(now: number): void {
    this.db
      .prepare<[number]>(
        'UPDATE attachments SET unreferenced_since = ? WHERE unreferenced_since IS NULL AND id NOT IN (SELECT attachment_id FROM note_attachments)',
      )
      .run(now);
    new DocumentBlobsRepo(this.db).reconcileReferences(now);
  }

  private ids(sql: string, param: string): string[] {
    return this.db
      .prepare<[string], { id: string }>(sql)
      .all(param)
      .map((r) => r.id);
  }
}
