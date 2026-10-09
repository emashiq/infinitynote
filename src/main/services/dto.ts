import type { FolderDtoType, NoteColorType, NoteDtoType, NoteSummaryType, ProjectDtoType } from '../../shared/contracts/hierarchy';
import { buildPathIndex, pathOf, type PathIndex } from '../../shared/tree/paths';
import type { FolderRow, HierarchyRepo, NoteMetaRow, ProjectRow } from '../db/repositories/hierarchy-repo';

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
  locked: r.locked === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toNoteSummary = (r: NoteMetaRow, index: PathIndex): NoteSummaryType => ({
  ...toNoteDto(r),
  path: pathOf(index, { projectId: r.project_id, folderId: r.folder_id }),
});

/** Display paths for the given project and folder rows. */
export function pathIndexFromRows(projects: readonly ProjectRow[], folders: readonly FolderRow[]): PathIndex {
  return buildPathIndex(
    projects.map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at })),
    folders.map((f) => ({ id: f.id, projectId: f.project_id, parentId: f.parent_id, name: f.name, createdAt: f.created_at })),
  );
}

/** Display paths of every live project and folder. */
export function livePathIndex(repo: HierarchyRepo): PathIndex {
  return pathIndexFromRows(repo.liveProjects(), repo.liveFolders());
}
