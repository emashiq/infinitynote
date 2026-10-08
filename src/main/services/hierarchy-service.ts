import type {
  FolderDtoType,
  FolderMoveResponseType,
  FolderTargetType,
  ItemKindType,
  LocationType,
  NoteDtoType,
  ProjectDtoType,
  TreeChangedEventType,
  TreeSnapshotType,
} from '../../shared/contracts/hierarchy';
import { normalizeName, normalizeTitle, validateName, validateTitle, NAME_MESSAGE, TITLE_MESSAGE } from '../../shared/names';
import type { Db } from '../db/driver';
import { HierarchyRepo, MAX_FOLDER_DEPTH } from '../db/repositories/hierarchy-repo';
import { NotesRepo } from '../db/repositories/notes-repo';
import { AppError } from './app-error';
import type { Clock } from './clock';
import { MSG, runTx, toFolderDto, toNoteDto, toProjectDto } from './dto';
import type { IdGenerator } from './ids';
import type { Logger } from './logger';

export interface HierarchyServiceDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  logger?: Logger;
  /** Called after each committed change that the renderer should hear about. */
  onChange: (event: TreeChangedEventType) => void;
}

export const EMPTY_DOC_JSON = '{"type":"doc","content":[{"type":"paragraph"}]}';

export class HierarchyService {
  readonly repo: HierarchyRepo;
  private readonly notes: NotesRepo;

  constructor(private readonly deps: HierarchyServiceDeps) {
    this.repo = new HierarchyRepo(deps.db);
    this.notes = new NotesRepo(deps.db);
  }

  private tx<T>(fn: () => T): T {
    return runTx(this.deps.db, this.deps.logger, fn);
  }

  private changed(reason: TreeChangedEventType['reason']): void {
    this.deps.onChange({ reason, trashedNoteIds: [] });
  }

  private checkInvariants(): void {
    const violation = this.repo.findInvariantViolation();
    if (violation) {
      this.deps.logger?.error(`hierarchy: invariant violated ${violation}`);
      throw new Error(`invariant: ${violation}`);
    }
  }

  private cleanName(raw: string): string {
    const name = normalizeName(raw);
    if (validateName(name) !== null) throw new AppError('VALIDATION_FAILED', NAME_MESSAGE);
    return name;
  }

  private cleanTitle(raw: string): string {
    const title = normalizeTitle(raw);
    if (validateTitle(title) !== null) throw new AppError('VALIDATION_FAILED', TITLE_MESSAGE);
    return title;
  }

  /** Validates that (projectId, parentFolderId) is a live scope location; returns the parent depth (0 at the root). */
  private assertLocation(projectId: string | null, folderId: string | null): number {
    if (projectId !== null) {
      const p = this.repo.getProject(projectId);
      if (!p) throw new AppError('NOT_FOUND', MSG.missing);
      if (p.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.inTrash);
    }
    if (folderId === null) return 0;
    const f = this.repo.getFolder(folderId);
    if (!f) throw new AppError('NOT_FOUND', MSG.missing);
    if (f.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.inTrash);
    if (f.project_id !== projectId) throw new AppError('VALIDATION_FAILED', MSG.scope);
    return this.repo.folderDepth(folderId);
  }

  // Reads --------------------------------------------------------------------
  list(): TreeSnapshotType {
    return {
      projects: this.repo.liveProjects().map(toProjectDto),
      folders: this.repo.liveFolders().map(toFolderDto),
      notes: this.repo.liveNotes().map(toNoteDto),
    };
  }

  // Projects -----------------------------------------------------------------
  createProject(rawName: string): { project: ProjectDtoType } {
    const name = this.cleanName(rawName);
    const project = this.tx(() => {
      const id = this.deps.ids.uuid();
      this.repo.insertProject(id, name, this.deps.clock.now());
      return toProjectDto(this.repo.getProject(id)!);
    });
    this.changed('create');
    return { project };
  }

  renameProject(projectId: string, rawName: string): { project: ProjectDtoType } {
    const name = this.cleanName(rawName);
    const project = this.tx(() => {
      const p = this.repo.getProject(projectId);
      if (!p || p.deleted_at !== null) throw new AppError('NOT_FOUND', p ? MSG.inTrash : MSG.missing);
      this.repo.renameProject(projectId, name, this.deps.clock.now());
      return toProjectDto(this.repo.getProject(projectId)!);
    });
    this.changed('rename');
    return { project };
  }

  // Folders ------------------------------------------------------------------
  createFolder(target: FolderTargetType, rawName: string): { folder: FolderDtoType } {
    const name = this.cleanName(rawName);
    const folder = this.tx(() => {
      const parentDepth = this.assertLocation(target.projectId, target.parentId);
      if (parentDepth + 1 > MAX_FOLDER_DEPTH) throw new AppError('LIMIT_EXCEEDED', MSG.depth);
      const id = this.deps.ids.uuid();
      this.repo.insertFolder(id, target.projectId, target.parentId, name, this.deps.clock.now());
      return toFolderDto(this.repo.getFolder(id)!);
    });
    this.changed('create');
    return { folder };
  }

  renameFolder(folderId: string, rawName: string): { folder: FolderDtoType } {
    const name = this.cleanName(rawName);
    const folder = this.tx(() => {
      const f = this.repo.getFolder(folderId);
      if (!f || f.deleted_at !== null) throw new AppError('NOT_FOUND', f ? MSG.inTrash : MSG.missing);
      this.repo.renameFolder(folderId, name, this.deps.clock.now());
      return toFolderDto(this.repo.getFolder(folderId)!);
    });
    this.changed('rename');
    return { folder };
  }

  moveFolder(folderId: string, target: FolderTargetType): FolderMoveResponseType {
    const result = this.tx(() => {
      const f = this.repo.getFolder(folderId);
      if (!f || f.deleted_at !== null) throw new AppError('NOT_FOUND', f ? MSG.inTrash : MSG.missing);
      if (target.projectId !== null) {
        const p = this.repo.getProject(target.projectId);
        if (!p) throw new AppError('NOT_FOUND', MSG.missing);
        if (p.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.inTrash);
      }
      if (target.parentId !== null) {
        const parent = this.repo.getFolder(target.parentId);
        if (!parent) throw new AppError('NOT_FOUND', MSG.missing);
        if (parent.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.inTrash);
        if (parent.project_id !== target.projectId) throw new AppError('VALIDATION_FAILED', MSG.scope);
        if (target.parentId === folderId || this.repo.subtreeIds(folderId).includes(target.parentId)) {
          throw new AppError('CYCLE', MSG.cycle);
        }
      }
      const parentDepth = target.parentId === null ? 0 : this.repo.folderDepth(target.parentId);
      if (parentDepth + 1 + this.repo.subtreeHeight(folderId) > MAX_FOLDER_DEPTH) throw new AppError('LIMIT_EXCEEDED', MSG.depth);
      if (f.parent_id === target.parentId && f.project_id === target.projectId) {
        return { folder: toFolderDto(f), movedFolders: 0, movedNotes: 0, noop: true };
      }
      const counts = this.repo.reparentFolder(folderId, target.projectId, target.parentId, this.deps.clock.now());
      this.checkInvariants();
      return {
        folder: toFolderDto(this.repo.getFolder(folderId)!),
        movedFolders: counts.folders,
        movedNotes: counts.notes,
        noop: false,
      };
    });
    if (!result.noop) this.changed('move');
    return { folder: result.folder, movedFolders: result.movedFolders, movedNotes: result.movedNotes };
  }

  // Notes --------------------------------------------------------------------
  createNote(location: LocationType, sticky: boolean, rawTitle?: string): { note: NoteDtoType } {
    const title = rawTitle === undefined ? '' : this.cleanTitle(rawTitle);
    const note = this.tx(() => {
      this.assertLocation(location.projectId, location.folderId);
      const id = this.deps.ids.uuid();
      this.notes.createNote({
        id,
        title,
        format: 'rich',
        contentJson: EMPTY_DOC_JSON,
        plainText: '',
        now: this.deps.clock.now(),
        projectId: location.projectId,
        folderId: location.folderId,
        sticky,
        color: sticky ? 'yellow' : null,
      });
      return toNoteDto(this.repo.getNoteMeta(id)!);
    });
    this.changed('create');
    return { note };
  }

  private liveNote(noteId: string) {
    const n = this.repo.getNoteMeta(noteId);
    if (!n || n.deleted_at !== null) throw new AppError('NOT_FOUND', n ? MSG.inTrash : MSG.missing);
    return n;
  }

  renameNote(noteId: string, rawTitle: string): { note: NoteDtoType } {
    const title = this.cleanTitle(rawTitle);
    const note = this.tx(() => {
      this.liveNote(noteId);
      this.repo.renameNote(noteId, title, this.deps.clock.now());
      return toNoteDto(this.repo.getNoteMeta(noteId)!);
    });
    this.changed('rename');
    return { note };
  }

  moveNote(noteId: string, target: LocationType): { note: NoteDtoType } {
    const note = this.tx(() => {
      this.liveNote(noteId);
      this.assertLocation(target.projectId, target.folderId);
      this.repo.moveNote(noteId, target.projectId, target.folderId);
      this.checkInvariants();
      return toNoteDto(this.repo.getNoteMeta(noteId)!);
    });
    this.changed('move');
    return { note };
  }

  setPinned(noteId: string, pinned: boolean): { note: NoteDtoType } {
    const note = this.tx(() => {
      this.liveNote(noteId);
      this.repo.setPinned(noteId, pinned, this.deps.clock.now());
      return toNoteDto(this.repo.getNoteMeta(noteId)!);
    });
    this.changed('pin');
    return { note };
  }

  setFavorite(kind: ItemKindType, id: string, favorite: boolean): { kind: ItemKindType; id: string; favorite: boolean } {
    this.tx(() => {
      const row = kind === 'project' ? this.repo.getProject(id) : kind === 'folder' ? this.repo.getFolder(id) : this.repo.getNoteMeta(id);
      if (!row || row.deleted_at !== null) throw new AppError('NOT_FOUND', row ? MSG.inTrash : MSG.missing);
      this.repo.setFavorite(kind, id, favorite);
    });
    this.changed('favorite');
    return { kind, id, favorite };
  }
}
