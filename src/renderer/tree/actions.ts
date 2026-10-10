import type { AppServices } from '../state/app-services';
import type { Outcome } from '../state/store';
import type { TreeNode } from '../../shared/tree/tree-model';

/** Pushes an error notice for a failed outcome; returns true when the outcome succeeded. */
export function report<T>(services: AppServices, outcome: Outcome<T>): outcome is Extract<Outcome<T>, { ok: true }> {
  if (outcome.ok) return true;
  services.notices.push(outcome.message, 'error');
  return false;
}

/** The node a menu or key action really applies to (favorite entries point at the real node). */
export function effectiveKey(node: TreeNode): string {
  return node.kind === 'favorite' && node.targetKey ? node.targetKey : node.key;
}

/** Creates a note at the tree node's location and opens it; a new sticky floats instead (D-069). */
export async function createNoteAt(services: AppServices, key: string, sticky: boolean): Promise<void> {
  const location = services.tree.locationFor(key);
  if (!location) return;
  if (sticky) {
    await services.commands.newSticky(location);
    return;
  }
  const res = await services.tree.createNote(location, { sticky: false });
  if (!report(services, res)) return;
  await services.tabs.openNote(res.data.note.id);
  services.ui.requestFocus({ target: 'noteTitle', noteId: res.data.note.id });
  if (services.layout.store.getState().treeMode === 'drawer') services.layout.closeDrawers();
}

export function openNewFolderAt(services: AppServices, key: string): void {
  const location = services.tree.locationFor(key);
  if (!location) return;
  services.ui.openDialog({ kind: 'newFolder', target: { projectId: location.projectId, parentId: location.folderId } });
}

export async function openNoteFromTree(services: AppServices, noteId: string): Promise<void> {
  await services.tabs.openNote(noteId);
  if (services.layout.store.getState().treeMode === 'drawer') services.layout.closeDrawers();
}

export async function openDocumentFromTree(services: AppServices, documentId: string): Promise<void> {
  await services.tabs.openDocument(documentId);
  if (services.layout.store.getState().treeMode === 'drawer') services.layout.closeDrawers();
}

/** New blank documents and "Import file…" at a tree node's location (D-118). */
export function documentCreation(services: AppServices, key: string): Array<{ id: string; label: string; onSelect: () => void }> {
  const location = services.tree.locationFor(key);
  if (!location) return [];
  const { documents } = services;
  return [
    { id: 'new-docx', label: 'New Word document', onSelect: () => void documents.createBlank('docx', location) },
    { id: 'new-xlsx', label: 'New spreadsheet', onSelect: () => void documents.createBlank('xlsx', location) },
    { id: 'new-pptx', label: 'New presentation', onSelect: () => void documents.createBlank('pptx', location) },
    { id: 'import', label: 'Import file…', onSelect: () => void documents.importFiles(location) },
  ];
}

export function trashItemCount(node: TreeNode): number {
  const t = node.trash;
  return t ? 1 + t.contains.folders + t.contains.notes + t.contains.documents : 1;
}
