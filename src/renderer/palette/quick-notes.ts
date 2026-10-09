import type { TreeSnapshotType } from '../../shared/contracts/hierarchy';
import { buildPathIndex, pathOf } from '../../shared/tree/paths';

export interface QuickNote {
  id: string;
  title: string;
  path: string[];
}

/** At most this many pinned and favorite notes each in the palette before anything is typed. */
export const QUICK_NOTES_LIMIT = 8;

/** Pinned notes (most recently pinned first) and favorite notes that are not pinned (most recent first). */
export function quickNotes(snapshot: TreeSnapshotType): { pinned: QuickNote[]; favorites: QuickNote[] } {
  const index = buildPathIndex(snapshot.projects, snapshot.folders);
  const toQuick = (n: TreeSnapshotType['notes'][number]): QuickNote => ({ id: n.id, title: n.title, path: pathOf(index, { projectId: n.projectId, folderId: n.folderId }) });
  const pinned = snapshot.notes
    .filter((n) => n.pinnedAt !== null)
    .sort((a, b) => b.pinnedAt! - a.pinnedAt!)
    .slice(0, QUICK_NOTES_LIMIT)
    .map(toQuick);
  const favorites = snapshot.notes
    .filter((n) => n.favorite && n.pinnedAt === null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, QUICK_NOTES_LIMIT)
    .map(toQuick);
  return { pinned, favorites };
}
