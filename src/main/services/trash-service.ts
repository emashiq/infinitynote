import type {
  LocationType,
  TrashItemType,
  TrashPurgeRequestType,
  TrashRestoreResponseType,
  TrashResultType,
  TreeChangedEventType,
} from '../../shared/contracts/hierarchy';
import { pathOf } from '../../shared/tree/paths';
import type { Db } from '../db/driver';
import { HierarchyRepo, type FolderRow, type NoteMetaRow, type ProjectRow } from '../db/repositories/hierarchy-repo';
import { TrashRepo } from '../db/repositories/trash-repo';
import { AppError } from './app-error';
import type { Clock } from './clock';
import { livePathIndex, pathIndexFromRows } from './dto';
import type { IdGenerator } from './ids';
import type { Logger } from './logger';
import { MSG } from './messages';
import { runTx } from './transaction';

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

interface BatchRoot {
  root: Root;
  /** Folders and notes in the batch besides the root. */
  folders: number;
  notes: number;
}

type PurgeCounts = { projects: number; folders: number; notes: number };

/** Guard against corrupt parent chains while walking up the folder tree. */
const MAX_ANCESTOR_STEPS = 100;

/** Soft-delete, restore and purge of projects, folders and notes in trash batches (D-046). */
export class TrashService {
  private readonly hierarchy: HierarchyRepo;
  private readonly repo: TrashRepo;

  constructor(private readonly deps: TrashServiceDeps) {
    this.hierarchy = new HierarchyRepo(deps.db);
    this.repo = new TrashRepo(deps.db);
  }

  private tx<T>(fn: () => T): T {
    return runTx(this.deps.db, this.deps.logger, fn);
  }

  // Trash ----------------------------------------------------------------------
  trashNote(noteId: string): TrashResultType {
    return this.trashBatch((batch, now) => {
      const n = this.hierarchy.getNoteMeta(noteId);
      if (!n || n.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.missing);
      this.repo.markNotes([noteId], batch, now);
      return { counts: { projects: 0, folders: 0, notes: 1 }, trashedNoteIds: [noteId] };
    });
  }

  trashFolder(folderId: string): TrashResultType {
    return this.trashBatch((batch, now) => {
      const f = this.hierarchy.getFolder(folderId);
      if (!f || f.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.missing);
      const subtree = this.hierarchy.subtreeIds(folderId);
      const folderIds = this.repo.liveFolderIds(subtree);
      this.repo.markFolders(folderIds, batch, now);
      const noteIds = this.repo.liveNoteIdsInFolders(subtree);
      this.repo.markNotes(noteIds, batch, now);
      return { counts: { projects: 0, folders: folderIds.length, notes: noteIds.length }, trashedNoteIds: noteIds };
    });
  }

  trashProject(projectId: string): TrashResultType {
    return this.trashBatch((batch, now) => {
      const p = this.hierarchy.getProject(projectId);
      if (!p || p.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.missing);
      const folders = this.repo.markProjectFolders(projectId, batch, now);
      const noteIds = this.repo.liveNoteIdsInProject(projectId);
      this.repo.markNotes(noteIds, batch, now);
      this.repo.markProject(projectId, batch, now);
      return { counts: { projects: 1, folders, notes: noteIds.length }, trashedNoteIds: noteIds };
    });
  }

  /** Marks one new batch in a single transaction and announces the trashed notes. */
  private trashBatch(mark: (batch: string, now: number) => Omit<TrashResultType, 'trashBatchId'>): TrashResultType {
    const result = this.tx((): TrashResultType => {
      const trashBatchId = this.deps.ids.uuid();
      return { trashBatchId, ...mark(trashBatchId, this.deps.clock.now()) };
    });
    this.deps.onChange({ reason: 'trash', trashedNoteIds: result.trashedNoteIds });
    return result;
  }

  // List -----------------------------------------------------------------------
  /** The root item of every batch: its project, else its top folder, else its note. */
  private batchRoots(): Map<string, BatchRoot> {
    const batches = new Map<string, { project?: ProjectRow; folders: FolderRow[]; notes: NoteMetaRow[] }>();
    const entry = (batch: string) => {
      let e = batches.get(batch);
      if (!e) {
        e = { folders: [], notes: [] };
        batches.set(batch, e);
      }
      return e;
    };
    for (const p of this.hierarchy.trashedProjects()) if (p.trash_batch_id) entry(p.trash_batch_id).project = p;
    for (const f of this.hierarchy.trashedFolders()) if (f.trash_batch_id) entry(f.trash_batch_id).folders.push(f);
    for (const n of this.hierarchy.trashedNotes()) if (n.trash_batch_id) entry(n.trash_batch_id).notes.push(n);

    const roots = new Map<string, BatchRoot>();
    for (const [batch, e] of batches) {
      if (e.project) {
        roots.set(batch, { root: { kind: 'project', row: e.project }, folders: e.folders.length, notes: e.notes.length });
        continue;
      }
      const inBatch = new Set(e.folders.map((f) => f.id));
      const rootFolder = e.folders.find((f) => f.parent_id === null || !inBatch.has(f.parent_id));
      if (rootFolder) {
        roots.set(batch, { root: { kind: 'folder', row: rootFolder }, folders: e.folders.length - 1, notes: e.notes.length });
      } else if (e.notes[0]) {
        roots.set(batch, { root: { kind: 'note', row: e.notes[0] }, folders: 0, notes: e.notes.length - 1 });
      }
    }
    return roots;
  }

  list(): { items: TrashItemType[] } {
    const index = pathIndexFromRows(this.hierarchy.allProjects(), this.hierarchy.allFolders());
    const items: TrashItemType[] = [];
    for (const [batchId, { root, folders, notes }] of this.batchRoots()) {
      const base = { batchId, kind: root.kind, id: root.row.id, deletedAt: root.row.deleted_at ?? 0, contains: { folders, notes } };
      if (root.kind === 'project') {
        items.push({ ...base, label: root.row.name, sticky: false, fromPath: [] });
      } else if (root.kind === 'folder') {
        const fromPath = pathOf(index, { projectId: root.row.project_id, folderId: root.row.parent_id });
        items.push({ ...base, label: root.row.name, sticky: false, fromPath });
      } else {
        const fromPath = pathOf(index, { projectId: root.row.project_id, folderId: root.row.folder_id });
        items.push({ ...base, label: root.row.title, sticky: root.row.sticky_enabled === 1, fromPath });
      }
    }
    items.sort((a, b) => b.deletedAt - a.deletedAt || (a.batchId < b.batchId ? -1 : 1));
    return { items };
  }

  // Restore --------------------------------------------------------------------
  /** Nearest live location for a restored folder or note: the original parent, a live ancestor, or the Common root. */
  private restoreTarget(original: LocationType): LocationType {
    if (original.projectId !== null) {
      const project = this.hierarchy.getProject(original.projectId);
      if (!project || project.deleted_at !== null) return { projectId: null, folderId: null };
    }
    let cur = original.folderId === null ? undefined : this.hierarchy.getFolder(original.folderId);
    for (let steps = 0; cur && cur.deleted_at !== null && steps < MAX_ANCESTOR_STEPS; steps += 1) {
      cur = cur.parent_id === null ? undefined : this.hierarchy.getFolder(cur.parent_id);
    }
    return { projectId: original.projectId, folderId: cur ? cur.id : null };
  }

  restore(batchId: string): TrashRestoreResponseType {
    const result = this.tx((): TrashRestoreResponseType => {
      const found = this.batchRoots().get(batchId);
      if (!found) throw new AppError('NOT_FOUND', MSG.noBatch);
      const { root } = found;
      let relocated = false;
      let location: LocationType;

      if (root.kind === 'project') {
        location = { projectId: root.row.id, folderId: null };
      } else {
        const original = { projectId: root.row.project_id, folderId: root.kind === 'folder' ? root.row.parent_id : root.row.folder_id };
        location = this.restoreTarget(original);
        const moved = location.projectId !== original.projectId || location.folderId !== original.folderId;
        relocated = moved || this.repo.isReanchored(batchId);
        if (moved) {
          if (root.kind === 'folder') this.hierarchy.reparentFolder(root.row.id, location.projectId, location.folderId, this.deps.clock.now());
          else this.hierarchy.moveNote(root.row.id, location.projectId, location.folderId);
        }
      }

      const restoredNoteIds = this.repo.noteIdsInBatch(batchId);
      this.repo.restoreBatch(batchId);
      this.hierarchy.assertInvariants();
      return {
        kind: root.kind,
        id: root.row.id,
        relocated,
        location,
        path: pathOf(livePathIndex(this.hierarchy), location),
        restoredNoteIds,
      };
    });
    this.deps.onChange({ reason: 'restore', trashedNoteIds: [] });
    return result;
  }

  // Purge ----------------------------------------------------------------------
  purge(req: TrashPurgeRequestType): { purged: PurgeCounts } {
    const result = this.purgeBatches(() => {
      if (req.target.kind === 'all') return this.repo.batchIds();
      if (!this.batchRoots().has(req.target.batchId)) throw new AppError('NOT_FOUND', MSG.noBatch);
      return [req.target.batchId];
    });
    return { purged: result ?? { projects: 0, folders: 0, notes: 0 } };
  }

  /** Automatic emptying of Trash (retention setting, D-034): batches trashed before `cutoff` are purged. */
  purgeDeletedBefore(cutoff: number): PurgeCounts | null {
    return this.purgeBatches(() => this.repo.batchIds(cutoff));
  }

  /** Purges the selected batches in one transaction; null (and no tree event) when there was nothing to purge. */
  private purgeBatches(select: () => string[]): PurgeCounts | null {
    const purged = this.tx(() => {
      const batches = select();
      if (batches.length === 0) return null;

      const projects = new Set(this.repo.idsInBatches('projects', batches));
      const folders = new Set(this.repo.idsInBatches('folders', batches));
      const notes = this.repo.idsInBatches('notes', batches);
      this.reanchorSurvivors(projects, folders, new Set(notes));
      this.repo.deletePurged(batches, { projects: [...projects], folders: [...folders], notes });
      this.repo.markUnreferencedAttachments(this.deps.clock.now());
      this.hierarchy.assertInvariants();
      return { projects: projects.size, folders: folders.size, notes: notes.length };
    });
    if (purged) this.deps.onChange({ reason: 'purge', trashedNoteIds: [] });
    return purged;
  }

  /**
   * Trashed rows of other batches that sit inside purged folders or projects move to the nearest kept folder
   * (or the Common root) before anything is deleted, and their batches are flagged as re-anchored.
   */
  private reanchorSurvivors(projects: ReadonlySet<string>, folders: ReadonlySet<string>, notes: ReadonlySet<string>): void {
    const folderById = new Map(this.hierarchy.allFolders().map((f) => [f.id, f]));
    const nearestKept = (folderId: string | null): string | null => {
      let cur = folderId;
      for (let steps = 0; cur !== null && folders.has(cur) && steps < MAX_ANCESTOR_STEPS; steps += 1) {
        cur = folderById.get(cur)?.parent_id ?? null;
      }
      return cur;
    };
    const keptFolder = (folderId: string | null) => (folderId !== null && folders.has(folderId) ? nearestKept(folderId) : folderId);
    const keptProject = (projectId: string | null) => (projectId !== null && projects.has(projectId) ? null : projectId);

    for (const f of folderById.values()) {
      if (folders.has(f.id)) continue;
      const parentId = keptFolder(f.parent_id);
      const projectId = keptProject(f.project_id);
      if (parentId === f.parent_id && projectId === f.project_id) continue;
      this.repo.setFolderLocation(f.id, projectId, parentId);
      if (f.trash_batch_id) this.repo.markReanchored(f.trash_batch_id);
    }
    for (const n of this.repo.notesIn([...folders], [...projects])) {
      if (notes.has(n.id)) continue;
      const folderId = keptFolder(n.folder_id);
      const projectId = keptProject(n.project_id);
      if (folderId === n.folder_id && projectId === n.project_id) continue;
      if (n.deleted_at === null) throw new Error(`live note ${n.id} references purged rows`);
      this.repo.setNoteLocation(n.id, projectId, folderId);
      if (n.trash_batch_id) this.repo.markReanchored(n.trash_batch_id);
    }
  }
}
