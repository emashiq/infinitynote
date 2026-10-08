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
import { NAME_MESSAGE, TITLE_MESSAGE, normalizeName, normalizeTitle, validateName, validateTitle } from '../../shared/names';
import type { Db } from '../db/driver';
import { HierarchyRepo, MAX_FOLDER_DEPTH, type NoteMetaRow } from '../db/repositories/hierarchy-repo';
import { NotesRepo } from '../db/repositories/notes-repo';
import { AppError } from './app-error';
import type { Clock } from './clock';
import { toFolderDto, toNoteDto, toProjectDto } from './dto';
import type { IdGenerator } from './ids';
import type { Logger } from './logger';
import { MSG } from './messages';
import { runTx } from './transaction';

export interface HierarchyServiceDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  logger?: Logger;
  /** Called after each committed change that the renderer should hear about. */
  onChange: (event: TreeChangedEventType) => void;
}

export const EMPTY_DOC_JSON = '{"type":"doc","content":[{"type":"paragraph"}]}';

/** Throws NOT_FOUND unless the row exists and is live. */
function requireLive<T extends { deleted_at: number | null }>(row: T | undefined): T {
  if (!row || row.deleted_at !== null) throw new AppError('NOT_FOUND', row ? MSG.inTrash : MSG.missing);
  return row;
}

/** Projects, folders and note metadata: create, rename, move, pin and favorite (trash lives in TrashService). */
export class HierarchyService {
  private readonly repo: HierarchyRepo;
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

  /** Validates that (projectId, folderId) is a live location in one scope; returns the folder depth (0 at the scope root). */
  private assertLocation(projectId: string | null, folderId: string | null): number {
    if (projectId !== null) requireLive(this.repo.getProject(projectId));
    if (folderId === null) return 0;
    const folder = requireLive(this.repo.getFolder(folderId));
    if (folder.project_id !== projectId) throw new AppError('VALIDATION_FAILED', MSG.scope);
    return this.repo.folderDepth(folderId);
  }

  private liveNote(noteId: string): NoteMetaRow {
    return requireLive(this.repo.getNoteMeta(noteId));
  }

  private noteDto(noteId: string): NoteDtoType {
    return toNoteDto(this.repo.getNoteMeta(noteId)!);
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
      requireLive(this.repo.getProject(projectId));
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
      requireLive(this.repo.getFolder(folderId));
      this.repo.renameFolder(folderId, name, this.deps.clock.now());
      return toFolderDto(this.repo.getFolder(folderId)!);
    });
    this.changed('rename');
    return { folder };
  }

  moveFolder(folderId: string, target: FolderTargetType): FolderMoveResponseType {
    const { response, moved } = this.tx(() => {
      const folder = requireLive(this.repo.getFolder(folderId));
      const parentDepth = this.assertLocation(target.projectId, target.parentId);
      if (target.parentId !== null && (target.parentId === folderId || this.repo.subtreeIds(folderId).includes(target.parentId))) {
        throw new AppError('CYCLE', MSG.cycle);
      }
      if (parentDepth + 1 + this.repo.subtreeHeight(folderId) > MAX_FOLDER_DEPTH) throw new AppError('LIMIT_EXCEEDED', MSG.depth);
      if (folder.parent_id === target.parentId && folder.project_id === target.projectId) {
        return { response: { folder: toFolderDto(folder), movedFolders: 0, movedNotes: 0 }, moved: false };
      }
      const counts = this.repo.reparentFolder(folderId, target.projectId, target.parentId, this.deps.clock.now());
      this.repo.assertInvariants();
      const updated = toFolderDto(this.repo.getFolder(folderId)!);
      return { response: { folder: updated, movedFolders: counts.folders, movedNotes: counts.notes }, moved: true };
    });
    if (moved) this.changed('move');
    return response;
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
      return this.noteDto(id);
    });
    this.changed('create');
    return { note };
  }

  renameNote(noteId: string, rawTitle: string): { note: NoteDtoType } {
    const title = this.cleanTitle(rawTitle);
    const note = this.tx(() => {
      this.liveNote(noteId);
      this.repo.renameNote(noteId, title, this.deps.clock.now());
      return this.noteDto(noteId);
    });
    this.changed('rename');
    return { note };
  }

  moveNote(noteId: string, target: LocationType): { note: NoteDtoType } {
    const note = this.tx(() => {
      this.liveNote(noteId);
      this.assertLocation(target.projectId, target.folderId);
      this.repo.moveNote(noteId, target.projectId, target.folderId);
      this.repo.assertInvariants();
      return this.noteDto(noteId);
    });
    this.changed('move');
    return { note };
  }

  setPinned(noteId: string, pinned: boolean): { note: NoteDtoType } {
    const note = this.tx(() => {
      this.liveNote(noteId);
      this.repo.setPinned(noteId, pinned, this.deps.clock.now());
      return this.noteDto(noteId);
    });
    this.changed('pin');
    return { note };
  }

  setFavorite(kind: ItemKindType, id: string, favorite: boolean): { kind: ItemKindType; id: string; favorite: boolean } {
    this.tx(() => {
      requireLive(kind === 'project' ? this.repo.getProject(id) : kind === 'folder' ? this.repo.getFolder(id) : this.repo.getNoteMeta(id));
      this.repo.setFavorite(kind, id, favorite);
    });
    this.changed('favorite');
    return { kind, id, favorite };
  }
}
