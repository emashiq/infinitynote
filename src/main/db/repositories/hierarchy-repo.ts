import type { HomeScopeType } from '../../../shared/contracts/home';
import type { Db } from '../driver';

export const MAX_FOLDER_DEPTH = 32;
const CTE_GUARD = 64;

export interface ProjectRow {
  id: string;
  name: string;
  favorite: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  trash_batch_id: string | null;
}

export interface FolderRow {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  name: string;
  favorite: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  trash_batch_id: string | null;
}

export interface NoteMetaRow {
  id: string;
  project_id: string | null;
  folder_id: string | null;
  title: string;
  sticky_enabled: number;
  color: string | null;
  pinned_at: number | null;
  favorite: number;
  revision: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  trash_batch_id: string | null;
}

const PROJECT_COLS = 'id, name, favorite, created_at, updated_at, deleted_at, trash_batch_id';
const FOLDER_COLS = 'id, project_id, parent_id, name, favorite, created_at, updated_at, deleted_at, trash_batch_id';
export const NOTE_META_COLS =
  'id, project_id, folder_id, title, sticky_enabled, color, pinned_at, favorite, revision, created_at, updated_at, deleted_at, trash_batch_id';

const SUBTREE_CTE = `WITH RECURSIVE sub(id, depth) AS (
  SELECT id, 0 FROM folders WHERE id = ?
  UNION ALL
  SELECT f.id, sub.depth + 1 FROM folders f JOIN sub ON f.parent_id = sub.id WHERE sub.depth < ${CTE_GUARD}
)`;

export function scopeFilter(scope: HomeScopeType, column = 'project_id'): { where: string; args: string[] } {
  if (scope.kind === 'common') return { where: ` AND ${column} IS NULL`, args: [] };
  if (scope.kind === 'project') return { where: ` AND ${column} = ?`, args: [scope.projectId] };
  return { where: '', args: [] };
}

export class HierarchyRepo {
  constructor(private readonly db: Db) {}

  // Reads ------------------------------------------------------------------
  getProject(id: string): ProjectRow | undefined {
    return this.db.prepare<[string], ProjectRow>(`SELECT ${PROJECT_COLS} FROM projects WHERE id = ?`).get(id);
  }
  getFolder(id: string): FolderRow | undefined {
    return this.db.prepare<[string], FolderRow>(`SELECT ${FOLDER_COLS} FROM folders WHERE id = ?`).get(id);
  }
  getNoteMeta(id: string): NoteMetaRow | undefined {
    return this.db.prepare<[string], NoteMetaRow>(`SELECT ${NOTE_META_COLS} FROM notes WHERE id = ?`).get(id);
  }
  liveProjects(): ProjectRow[] {
    return this.db.prepare<[], ProjectRow>(`SELECT ${PROJECT_COLS} FROM projects WHERE deleted_at IS NULL`).all();
  }
  liveFolders(): FolderRow[] {
    return this.db.prepare<[], FolderRow>(`SELECT ${FOLDER_COLS} FROM folders WHERE deleted_at IS NULL`).all();
  }
  liveNotes(): NoteMetaRow[] {
    return this.db.prepare<[], NoteMetaRow>(`SELECT ${NOTE_META_COLS} FROM notes WHERE deleted_at IS NULL`).all();
  }
  allProjects(): ProjectRow[] {
    return this.db.prepare<[], ProjectRow>(`SELECT ${PROJECT_COLS} FROM projects`).all();
  }
  allFolders(): FolderRow[] {
    return this.db.prepare<[], FolderRow>(`SELECT ${FOLDER_COLS} FROM folders`).all();
  }
  trashedProjects(): ProjectRow[] {
    return this.db.prepare<[], ProjectRow>(`SELECT ${PROJECT_COLS} FROM projects WHERE deleted_at IS NOT NULL`).all();
  }
  trashedFolders(): FolderRow[] {
    return this.db.prepare<[], FolderRow>(`SELECT ${FOLDER_COLS} FROM folders WHERE deleted_at IS NOT NULL`).all();
  }
  trashedNotes(): NoteMetaRow[] {
    return this.db.prepare<[], NoteMetaRow>(`SELECT ${NOTE_META_COLS} FROM notes WHERE deleted_at IS NOT NULL`).all();
  }

  /** Ids of the folder and all of its descendants (live and trashed). */
  subtreeIds(folderId: string): string[] {
    return this.db
      .prepare<[string], { id: string }>(`${SUBTREE_CTE} SELECT id FROM sub`)
      .all(folderId)
      .map((r) => r.id);
  }

  /** Greatest depth below the folder (0 for a leaf). */
  subtreeHeight(folderId: string): number {
    const row = this.db.prepare<[string], { h: number }>(`${SUBTREE_CTE} SELECT max(depth) AS h FROM sub`).get(folderId);
    return row?.h ?? 0;
  }

  /** Number of folders from the scope root down to and including this folder. */
  folderDepth(folderId: string): number {
    let depth = 0;
    let cur: string | null = folderId;
    while (cur !== null && depth <= CTE_GUARD) {
      const row: { parent_id: string | null } | undefined = this.db
        .prepare<[string], { parent_id: string | null }>('SELECT parent_id FROM folders WHERE id = ?')
        .get(cur);
      if (!row) break;
      depth += 1;
      cur = row.parent_id;
    }
    return depth;
  }

  // Writes -----------------------------------------------------------------
  insertProject(id: string, name: string, now: number): void {
    this.db
      .prepare<[string, string, number, number]>('INSERT INTO projects(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, name, now, now);
  }
  insertFolder(id: string, projectId: string | null, parentId: string | null, name: string, now: number): void {
    this.db
      .prepare<[string, string | null, string | null, string, number, number]>(
        'INSERT INTO folders(id, project_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, projectId, parentId, name, now, now);
  }
  renameProject(id: string, name: string, now: number): void {
    this.db.prepare<[string, number, string]>('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
  }
  renameFolder(id: string, name: string, now: number): void {
    this.db.prepare<[string, number, string]>('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
  }
  renameNote(id: string, title: string, now: number): void {
    this.db.prepare<[string, number, string]>('UPDATE notes SET title = ?, updated_at = ? WHERE id = ?').run(title, now, id);
  }
  moveNote(id: string, projectId: string | null, folderId: string | null): void {
    this.db
      .prepare<[string | null, string | null, string]>('UPDATE notes SET project_id = ?, folder_id = ? WHERE id = ?')
      .run(projectId, folderId, id);
  }
  setPinned(id: string, pinned: boolean, now: number): void {
    if (pinned) this.db.prepare<[number, string]>('UPDATE notes SET pinned_at = COALESCE(pinned_at, ?) WHERE id = ?').run(now, id);
    else this.db.prepare<[string]>('UPDATE notes SET pinned_at = NULL WHERE id = ?').run(id);
  }
  /** Sticky presentation never changes the note's revision or updated_at (D-062). */
  setSticky(id: string, enabled: boolean): void {
    if (enabled) this.db.prepare<[string]>("UPDATE notes SET sticky_enabled = 1, color = COALESCE(color, 'yellow') WHERE id = ?").run(id);
    else this.db.prepare<[string]>('UPDATE notes SET sticky_enabled = 0 WHERE id = ?').run(id);
  }
  setColor(id: string, color: string): void {
    this.db.prepare<[string, string]>('UPDATE notes SET color = ? WHERE id = ?').run(color, id);
  }
  setFavorite(kind: 'project' | 'folder' | 'note', id: string, favorite: boolean): void {
    const table = kind === 'project' ? 'projects' : kind === 'folder' ? 'folders' : 'notes';
    this.db.prepare<[number, string]>(`UPDATE ${table} SET favorite = ? WHERE id = ?`).run(favorite ? 1 : 0, id);
  }

  /**
   * Reparents a folder and propagates its project to the whole subtree and its notes, trashed rows included.
   * Returns the number of folders (including the root of the subtree) and notes in the subtree.
   */
  reparentFolder(folderId: string, projectId: string | null, parentId: string | null, now: number): { folders: number; notes: number } {
    this.db
      .prepare<[string | null, string | null, number, string]>('UPDATE folders SET parent_id = ?, project_id = ?, updated_at = ? WHERE id = ?')
      .run(parentId, projectId, now, folderId);
    const subtree = this.subtreeIds(folderId);
    const ids = JSON.stringify(subtree);
    this.db
      .prepare<[string | null, string, string]>(
        'UPDATE folders SET project_id = ? WHERE id IN (SELECT value FROM json_each(?)) AND id <> ?',
      )
      .run(projectId, ids, folderId);
    const notes = this.db
      .prepare<[string | null, string]>('UPDATE notes SET project_id = ? WHERE folder_id IN (SELECT value FROM json_each(?))')
      .run(projectId, ids);
    return { folders: subtree.length, notes: notes.changes };
  }

  // Home ---------------------------------------------------------------------
  /** Live pinned notes in the scope, most recently pinned first. */
  pinnedNotes(scope: HomeScopeType, limit: number): NoteMetaRow[] {
    const { where, args } = scopeFilter(scope);
    return this.db
      .prepare<string[], NoteMetaRow>(
        `SELECT ${NOTE_META_COLS} FROM notes WHERE deleted_at IS NULL AND pinned_at IS NOT NULL${where} ORDER BY pinned_at DESC, id LIMIT ${limit}`,
      )
      .all(...args);
  }

  countPinned(scope: HomeScopeType): number {
    const { where, args } = scopeFilter(scope);
    const row = this.db
      .prepare<string[], { n: number }>(`SELECT count(*) AS n FROM notes WHERE deleted_at IS NULL AND pinned_at IS NOT NULL${where}`)
      .get(...args);
    return row?.n ?? 0;
  }

  /** Live notes in the scope, most recently updated first. */
  recentNotes(scope: HomeScopeType, limit: number): NoteMetaRow[] {
    const { where, args } = scopeFilter(scope);
    return this.db
      .prepare<string[], NoteMetaRow>(
        `SELECT ${NOTE_META_COLS} FROM notes WHERE deleted_at IS NULL${where} ORDER BY updated_at DESC, id LIMIT ${limit}`,
      )
      .all(...args);
  }

  // Invariants (8.1) ---------------------------------------------------------
  /** Throws when the hierarchy breaks an invariant; called inside write transactions so the change rolls back. */
  assertInvariants(): void {
    const violation = this.findInvariantViolation();
    if (violation) throw new Error(`invariant violated: ${violation}`);
  }

  findInvariantViolation(): string | null {
    const one = (sql: string): string | null => {
      const row = this.db.prepare<[], { id: string }>(`${sql} LIMIT 1`).get();
      return row ? row.id : null;
    };
    let id = one('SELECT f.id AS id FROM folders f JOIN folders p ON p.id = f.parent_id WHERE f.project_id IS NOT p.project_id');
    if (id) return `folder ${id} has a different project than its parent`;
    id = one('SELECT n.id AS id FROM notes n JOIN folders f ON f.id = n.folder_id WHERE n.project_id IS NOT f.project_id');
    if (id) return `note ${id} has a different project than its folder`;
    id = one(
      `SELECT f.id AS id FROM folders f WHERE f.deleted_at IS NULL AND (
         EXISTS (SELECT 1 FROM folders p WHERE p.id = f.parent_id AND p.deleted_at IS NOT NULL)
         OR EXISTS (SELECT 1 FROM projects pr WHERE pr.id = f.project_id AND pr.deleted_at IS NOT NULL))`,
    );
    if (id) return `live folder ${id} has a trashed parent or project`;
    id = one(
      `SELECT n.id AS id FROM notes n WHERE n.deleted_at IS NULL AND (
         EXISTS (SELECT 1 FROM folders f WHERE f.id = n.folder_id AND f.deleted_at IS NOT NULL)
         OR EXISTS (SELECT 1 FROM projects pr WHERE pr.id = n.project_id AND pr.deleted_at IS NOT NULL))`,
    );
    if (id) return `live note ${id} has a trashed folder or project`;
    const reach = this.db
      .prepare<[], { missing: number; maxDepth: number | null }>(
        `WITH RECURSIVE r(id, depth) AS (
           SELECT id, 1 FROM folders WHERE parent_id IS NULL
           UNION ALL
           SELECT f.id, r.depth + 1 FROM folders f JOIN r ON f.parent_id = r.id WHERE r.depth < 200)
         SELECT (SELECT count(*) FROM folders) - (SELECT count(DISTINCT id) FROM r) AS missing,
                (SELECT max(depth) FROM r) AS maxDepth`,
      )
      .get();
    if (reach && reach.missing !== 0) return 'folder cycle or unreachable folder';
    if (reach && (reach.maxDepth ?? 0) > MAX_FOLDER_DEPTH) return `folder depth ${reach.maxDepth} exceeds ${MAX_FOLDER_DEPTH}`;
    return null;
  }
}
