import { useMemo } from 'react';
import type { TreeSnapshotType } from '../../shared/contracts/hierarchy';
import { buildPathIndex, pathOf } from '../../shared/tree/paths';
import type { NoteController } from './note-controller';
import { useServices, useStore } from '../state/use-store';

export interface LiveNote {
  title: string;
  path: string[];
  updatedAt: number | null;
  /** The note is locked (D-111). */
  locked: boolean;
}

/** Title and location of a note taken from the tree snapshot when it lists the note, else from the opened copy. */
export function liveNoteFrom(
  snapshot: TreeSnapshotType,
  noteId: string,
  opened: { title: string; path: string[]; locked: boolean } | null,
): LiveNote | null {
  const live = snapshot.notes.find((n) => n.id === noteId);
  if (!live) return opened ? { title: opened.title, path: opened.path, updatedAt: null, locked: opened.locked } : null;
  const index = buildPathIndex(snapshot.projects, snapshot.folders);
  return { title: live.title, path: pathOf(index, { projectId: live.projectId, folderId: live.folderId }), updatedAt: live.updatedAt, locked: live.locked };
}

export function useLiveNote(controller: NoteController): LiveNote | null {
  const { tree } = useServices();
  const { snapshot } = useStore(tree.store);
  const { note } = useStore(controller.store);
  return useMemo(() => liveNoteFrom(snapshot, controller.noteId, note), [snapshot, controller.noteId, note]);
}
