import type { FolderDtoType, NoteColorType, NoteDtoType, NoteSummaryType, ProjectDtoType } from '../../shared/contracts/hierarchy';
import { pathOf } from '../../shared/tree/paths';
import type { Db } from '../db/driver';
import type { FolderRow, NoteMetaRow, ProjectRow } from '../db/repositories/hierarchy-repo';
import { AppError } from './app-error';
import type { Logger } from './logger';

export const toProjectDto = (r: ProjectRow): ProjectDtoType => ({
  id: r.id,
  name: r.name,
  favorite: r.favorite === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toFolderDto = (r: FolderRow): FolderDtoType => ({
  id: r.id,
  projectId: r.project_id,
  parentId: r.parent_id,
  name: r.name,
  favorite: r.favorite === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toNoteDto = (r: NoteMetaRow): NoteDtoType => ({
  id: r.id,
  projectId: r.project_id,
  folderId: r.folder_id,
  title: r.title,
  sticky: r.sticky_enabled === 1,
  color: r.color as NoteColorType | null,
  pinnedAt: r.pinned_at,
  favorite: r.favorite === 1,
  revision: r.revision,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toNoteSummary = (r: NoteMetaRow, index: ReadonlyMap<string, string[]>): NoteSummaryType => ({
  ...toNoteDto(r),
  path: pathOf(index, { projectId: r.project_id, folderId: r.folder_id }),
});

/** Runs fn in an immediate transaction; non-AppError failures become INTERNAL with nothing changed. */
export function runTx<T>(db: Db, logger: Logger | undefined, fn: () => T): T {
  try {
    return db.transaction(fn, 'immediate');
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger?.error(`hierarchy: transaction failed ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    throw new AppError('INTERNAL', 'Something went wrong');
  }
}

export const MSG = {
  cycle: 'A folder cannot be moved into itself or one of its subfolders.',
  depth: 'Folders can be nested at most 32 levels deep.',
  inTrash: 'That location is in Trash.',
  missing: 'That item no longer exists.',
  noteInTrash: 'This note is in Trash',
  scope: 'That folder belongs to a different scope.',
  noBatch: 'That item is no longer in Trash.',
} as const;
