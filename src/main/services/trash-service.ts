import type {
  TrashItemType,
  TrashPurgeRequestType,
  TrashRestoreResponseType,
  TrashResultType,
  TreeChangedEventType,
} from '../../shared/contracts/hierarchy';
import { buildPathIndex, pathOf } from '../../shared/tree/paths';
import type { Db } from '../db/driver';
import { HierarchyRepo, NOTE_META_COLS, type FolderRow, type NoteMetaRow, type ProjectRow } from '../db/repositories/hierarchy-repo';
import { AppError } from './app-error';
import type { Clock } from './clock';
import { MSG, runTx } from './dto';
import type { IdGenerator } from './ids';
import type { Logger } from './logger';

export interface TrashServiceDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  logger?: Logger;
  onChange: (event: TreeChangedEventType) => void;
}

type Root =
  | { kind: 'project'; row: ProjectRow }
  | { kind: 'folder'; row: FolderRow }
  | { kind: 'note'; row: NoteMetaRow };

const jsonIds = (ids: readonly string[]) => JSON.stringify(ids);

export class TrashService {
  private readonly repo: HierarchyRepo;

  constructor(private readonly deps: TrashServiceDeps) {
    this.repo = new HierarchyRepo(deps.db);
  }

  private tx<T>(fn: () => T): T {
    return runTx(this.deps.db, this.deps.logger, fn);
  }

  private checkInvariants(): void {
    const v = this.repo.findInvariantViolation();
    if (v) {
      this.deps.logger?.error(`trash: invariant violated ${v}`);
      throw new Error(`invariant: ${v}`);
    }
  }

  // Trash ----------------------------------------------------------------------
  trashNote(noteId: string): TrashResultType {
    const result = this.tx(() => {
      const n = this.repo.getNoteMeta(noteId);
      if (!n || n.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.missing);
      const batch = this.deps.ids.uuid();
      this.deps.db
        .prepare<[number, string, string]>('UPDATE notes SET deleted_at = ?, trash_batch_id = ? WHERE id = ?')
        .run(this.deps.clock.now(), batch, noteId);
      return { trashBatchId: batch, counts: { projects: 0, folders: 0, notes: 1 }, trashedNoteIds: [noteId] };
    });
    this.deps.onChange({ reason: 'trash', trashedNoteIds: result.trashedNoteIds });
    return result;
  }

  private markNotes(where: string, param: string, batch: string, now: number): string[] {
    const ids = this.deps.db
      .prepare<[string], { id: string }>(`SELECT id FROM notes WHERE ${where} AND deleted_at IS NULL`)
      .all(param)
      .map((r) => r.id);
    this.deps.db
      .prepare<[number, string, string]>(
        `UPDATE notes SET deleted_at = ?, trash_batch_id = ? WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .run(now, batch, jsonIds(ids));
    return ids;
  }

  trashFolder(folderId: string): TrashResultType {
    const result = this.tx(() => {
      const f = this.repo.getFolder(folderId);
      if (!f || f.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.missing);
      const batch = this.deps.ids.uuid();
      const now = this.deps.clock.now();
      const subtree = this.repo.subtreeIds(folderId);
      const liveFolders = this.deps.db
        .prepare<[string], { id: string }>(
          'SELECT id FROM folders WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL',
        )
        .all(jsonIds(subtree))
        .map((r) => r.id);
      this.deps.db
        .prepare<[number, string, string]>('UPDATE folders SET deleted_at = ?, trash_batch_id = ? WHERE id IN (SELECT value FROM json_each(?))')
        .run(now, batch, jsonIds(liveFolders));
      const noteIds = this.deps.db
        .prepare<[string], { id: string }>(
          'SELECT id FROM notes WHERE folder_id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL',
        )
        .all(jsonIds(subtree))
        .map((r) => r.id);
      this.deps.db
        .prepare<[number, string, string]>('UPDATE notes SET deleted_at = ?, trash_batch_id = ? WHERE id IN (SELECT value FROM json_each(?))')
        .run(now, batch, jsonIds(noteIds));
      return {
        trashBatchId: batch,
        counts: { projects: 0, folders: liveFolders.length, notes: noteIds.length },
        trashedNoteIds: noteIds,
      };
    });
    this.deps.onChange({ reason: 'trash', trashedNoteIds: result.trashedNoteIds });
    return result;
  }

  trashProject(projectId: string): TrashResultType {
    const result = this.tx(() => {
      const p = this.repo.getProject(projectId);
      if (!p || p.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.missing);
      const batch = this.deps.ids.uuid();
      const now = this.deps.clock.now();
      const folders = this.deps.db
        .prepare<[string], { n: number }>('SELECT count(*) AS n FROM folders WHERE project_id = ? AND deleted_at IS NULL')
        .get(projectId)?.n;
      this.deps.db
        .prepare<[number, string, string]>(
          'UPDATE folders SET deleted_at = ?, trash_batch_id = ? WHERE project_id = ? AND deleted_at IS NULL',
        )
        .run(now, batch, projectId);
      const noteIds = this.markNotes('project_id = ?', projectId, batch, now);
      this.deps.db.prepare<[number, string, string]>('UPDATE projects SET deleted_at = ?, trash_batch_id = ? WHERE id = ?').run(now, batch, projectId);
      return {
        trashBatchId: batch,
        counts: { projects: 1, folders: folders ?? 0, notes: noteIds.length },
        trashedNoteIds: noteIds,
      };
    });
    this.deps.onChange({ reason: 'trash', trashedNoteIds: result.trashedNoteIds });
    return result;
  }

  // List -----------------------------------------------------------------------
  private findRoots(): Map<string, { root: Root; folders: number; notes: number }> {
    const projects = this.repo.trashedProjects();
    const folders = this.repo.trashedFolders();
    const notes = this.repo.trashedNotes();
    const batches = new Map<string, { project?: ProjectRow; folders: FolderRow[]; notes: NoteMetaRow[] }>();
    const entry = (b: string) => {
      let e = batches.get(b);
      if (!e) {
        e = { folders: [], notes: [] };
        batches.set(b, e);
      }
      return e;
    };
    for (const p of projects) if (p.trash_batch_id) entry(p.trash_batch_id).project = p;
    for (const f of folders) if (f.trash_batch_id) entry(f.trash_batch_id).folders.push(f);
    for (const n of notes) if (n.trash_batch_id) entry(n.trash_batch_id).notes.push(n);
    const out = new Map<string, { root: Root; folders: number; notes: number }>();
    for (const [batch, e] of batches) {
      if (e.project) {
        out.set(batch, { root: { kind: 'project', row: e.project }, folders: e.folders.length, notes: e.notes.length });
        continue;
      }
      const inBatch = new Set(e.folders.map((f) => f.id));
      const rootFolder = e.folders.find((f) => f.parent_id === null || !inBatch.has(f.parent_id));
      if (rootFolder) {
        out.set(batch, { root: { kind: 'folder', row: rootFolder }, folders: e.folders.length - 1, notes: e.notes.length });
      } else if (e.notes[0]) {
        out.set(batch, { root: { kind: 'note', row: e.notes[0] }, folders: 0, notes: e.notes.length - 1 });
      }
    }
    return out;
  }

  list(): { items: TrashItemType[] } {
    const roots = this.findRoots();
    const index = buildPathIndex(
      this.repo.allProjects().map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at })),
      this.repo.allFolders().map((f) => ({ id: f.id, projectId: f.project_id, parentId: f.parent_id, name: f.name, createdAt: f.created_at })),
    );
    const items: TrashItemType[] = [];
    for (const [batchId, { root, folders, notes }] of roots) {
      let fromPath: string[] = [];
      let label: string;
      let sticky = false;
      if (root.kind === 'project') {
        label = root.row.name;
      } else if (root.kind === 'folder') {
        label = root.row.name;
        fromPath = pathOf(index, { projectId: root.row.project_id, folderId: root.row.parent_id });
      } else {
        label = root.row.title;
        sticky = root.row.sticky_enabled === 1;
        fromPath = pathOf(index, { projectId: root.row.project_id, folderId: root.row.folder_id });
      }
      items.push({
        batchId,
        kind: root.kind,
        id: root.row.id,
        label,
        sticky,
        deletedAt: root.row.deleted_at ?? 0,
        fromPath,
        contains: { folders, notes },
      });
    }
    items.sort((a, b) => b.deletedAt - a.deletedAt || (a.batchId < b.batchId ? -1 : 1));
    return { items };
  }

  // Restore --------------------------------------------------------------------
  restore(batchId: string): TrashRestoreResponseType {
    const result = this.tx(() => {
      const found = this.findRoots().get(batchId);
      if (!found) throw new AppError('NOT_FOUND', MSG.noBatch);
      const { root } = found;
      const now = this.deps.clock.now();
      let relocated = false;
      let location: { projectId: string | null; folderId: string | null };

      if (root.kind === 'project') {
        location = { projectId: root.row.id, folderId: null };
      } else {
        const origProject = root.row.project_id;
        const origParent = root.kind === 'folder' ? root.row.parent_id : root.row.folder_id;
        let target: { projectId: string | null; folderId: string | null };
        const proj = origProject === null ? undefined : this.repo.getProject(origProject);
        if (origProject !== null && (!proj || proj.deleted_at !== null)) {
          target = { projectId: null, folderId: null };
        } else {
          let cur = origParent === null ? undefined : this.repo.getFolder(origParent);
          let guard = 0;
          while (cur && cur.deleted_at !== null && guard < 100) {
            cur = cur.parent_id === null ? undefined : this.repo.getFolder(cur.parent_id);
            guard += 1;
          }
          target = { projectId: origProject, folderId: cur ? cur.id : null };
        }
        const reanchored = this.deps.db.prepare<[string], { batch_id: string }>('SELECT batch_id FROM trash_reanchored WHERE batch_id = ?').get(batchId) !== undefined;
        relocated = reanchored || target.projectId !== origProject || target.folderId !== origParent;
        if (target.projectId !== origProject || target.folderId !== origParent) {
          if (root.kind === 'folder') this.repo.reparentFolder(root.row.id, target.projectId, target.folderId, now);
          else this.repo.moveNote(root.row.id, target.projectId, target.folderId);
        }
        location = target;
      }

      const restoredNoteIds = this.deps.db
        .prepare<[string], { id: string }>('SELECT id FROM notes WHERE trash_batch_id = ?')
        .all(batchId)
        .map((r) => r.id);
      for (const table of ['projects', 'folders', 'notes']) {
        this.deps.db.prepare<[string]>(`UPDATE ${table} SET deleted_at = NULL, trash_batch_id = NULL WHERE trash_batch_id = ?`).run(batchId);
      }
      this.deps.db.prepare<[string]>('DELETE FROM trash_reanchored WHERE batch_id = ?').run(batchId);
      this.checkInvariants();
      const index = buildPathIndex(
        this.repo.liveProjects().map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at })),
        this.repo.liveFolders().map((f) => ({ id: f.id, projectId: f.project_id, parentId: f.parent_id, name: f.name, createdAt: f.created_at })),
      );
      return {
        kind: root.kind,
        id: root.row.id,
        relocated,
        location,
        path: pathOf(index, location),
        restoredNoteIds,
      } satisfies TrashRestoreResponseType;
    });
    this.deps.onChange({ reason: 'restore', trashedNoteIds: [] });
    return result;
  }

  // Purge ----------------------------------------------------------------------
  purge(req: TrashPurgeRequestType): { purged: { projects: number; folders: number; notes: number } } {
    const result = this.tx(() => {
      const roots = this.findRoots();
      let batches: string[];
      if (req.target.kind === 'all') {
        batches = [...new Set(
          (
            ['projects', 'folders', 'notes'] as const
          ).flatMap((t) =>
            this.deps.db
              .prepare<[], { b: string }>(`SELECT DISTINCT trash_batch_id AS b FROM ${t} WHERE deleted_at IS NOT NULL AND trash_batch_id IS NOT NULL`)
              .all()
              .map((r) => r.b),
          ),
        )];
      } else {
        if (!roots.has(req.target.batchId)) throw new AppError('NOT_FOUND', MSG.noBatch);
        batches = [req.target.batchId];
      }
      if (batches.length === 0) return { projects: 0, folders: 0, notes: 0 };
      const b = jsonIds(batches);
      const db = this.deps.db;
      const ids = (table: string) =>
        db
          .prepare<[string], { id: string }>(`SELECT id FROM ${table} WHERE trash_batch_id IN (SELECT value FROM json_each(?))`)
          .all(b)
          .map((r) => r.id);
      const purgedProjects = new Set(ids('projects'));
      const purgedFolders = new Set(ids('folders'));
      const purgedNotes = ids('notes');

      // Re-anchor survivors (trashed rows of other batches) before anything is deleted.
      const folderById = new Map(this.repo.allFolders().map((f) => [f.id, f]));
      const nearestKept = (folderId: string | null): string | null => {
        let cur = folderId;
        let guard = 0;
        while (cur !== null && purgedFolders.has(cur) && guard < 100) {
          cur = folderById.get(cur)?.parent_id ?? null;
          guard += 1;
        }
        return cur;
      };
      for (const f of folderById.values()) {
        if (purgedFolders.has(f.id)) continue;
        const parent = f.parent_id !== null && purgedFolders.has(f.parent_id) ? nearestKept(f.parent_id) : f.parent_id;
        const project = f.project_id !== null && purgedProjects.has(f.project_id) ? null : f.project_id;
        if (parent !== f.parent_id || project !== f.project_id) {
          db.prepare<[string | null, string | null, string]>('UPDATE folders SET parent_id = ?, project_id = ? WHERE id = ?').run(parent, project, f.id);
          if (f.trash_batch_id) db.prepare<[string]>('INSERT OR IGNORE INTO trash_reanchored(batch_id) VALUES (?)').run(f.trash_batch_id);
        }
      }
      const referencing = db
        .prepare<[string, string], NoteMetaRow>(
          `SELECT ${NOTE_META_COLS} FROM notes WHERE folder_id IN (SELECT value FROM json_each(?)) OR project_id IN (SELECT value FROM json_each(?))`,
        )
        .all(jsonIds([...purgedFolders]), jsonIds([...purgedProjects]));
      const purgedNoteSet = new Set(purgedNotes);
      for (const n of referencing) {
        if (purgedNoteSet.has(n.id)) continue;
        const folder = n.folder_id !== null && purgedFolders.has(n.folder_id) ? nearestKept(n.folder_id) : n.folder_id;
        const project = n.project_id !== null && purgedProjects.has(n.project_id) ? null : n.project_id;
        if (folder !== n.folder_id || project !== n.project_id) {
          if (n.deleted_at === null) throw new Error(`live note ${n.id} references purged rows`);
          db.prepare<[string | null, string | null, string]>('UPDATE notes SET folder_id = ?, project_id = ? WHERE id = ?').run(folder, project, n.id);
          if (n.trash_batch_id) db.prepare<[string]>('INSERT OR IGNORE INTO trash_reanchored(batch_id) VALUES (?)').run(n.trash_batch_id);
        }
      }

      db.prepare<[string]>('DELETE FROM trash_reanchored WHERE batch_id IN (SELECT value FROM json_each(?))').run(b);
      db.prepare<[string]>('DELETE FROM notes WHERE id IN (SELECT value FROM json_each(?))').run(jsonIds(purgedNotes));
      const folderIds = jsonIds([...purgedFolders]);
      for (let round = 0; round < 40; round += 1) {
        const r = db
          .prepare<[string]>(
            'DELETE FROM folders WHERE id IN (SELECT value FROM json_each(?)) AND NOT EXISTS (SELECT 1 FROM folders c WHERE c.parent_id = folders.id)',
          )
          .run(folderIds);
        if (r.changes === 0) break;
      }
      db.prepare<[string]>('DELETE FROM projects WHERE id IN (SELECT value FROM json_each(?))').run(jsonIds([...purgedProjects]));
      db.prepare<[number]>(
        'UPDATE attachments SET unreferenced_since = ? WHERE unreferenced_since IS NULL AND id NOT IN (SELECT attachment_id FROM note_attachments)',
      ).run(this.deps.clock.now());
      this.checkInvariants();
      return { projects: purgedProjects.size, folders: purgedFolders.size, notes: purgedNotes.length };
    });
    this.deps.onChange({ reason: 'purge', trashedNoteIds: [] });
    return { purged: result };
  }
}
