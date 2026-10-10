import type { GraphScopeType } from '../../shared/contracts/graph';
import { useServices, useStore } from '../state/use-store';
import { Menu, type MenuItem } from '../ui/Menu';
import { createNoteAt, documentCreation, effectiveKey, openDocumentFromTree, openNewFolderAt, openNoteFromTree, report, trashItemCount } from './actions';

/** Context menu for the tree node named by UiState.menu, with the item lists from the plan (11.6). */
export function TreeContextMenu() {
  const services = useServices();
  const { tree, ui } = services;
  const { menu } = useStore(ui.store);
  const { model } = useStore(tree.store);
  if (!menu) return null;
  const node = model.nodes.get(menu.key);
  if (!node) return null;
  const key = effectiveKey(node);
  const target = model.nodes.get(key) ?? node;
  const close = () => ui.closeMenu();
  const items: MenuItem[] = [];
  const add = (id: string, label: string, onSelect: () => void, disabled = false) => items.push({ id, label, onSelect, disabled });

  const creation = () => {
    add('note', 'New note', () => void createNoteAt(services, key, false));
    add('sticky', 'New sticky', () => void createNoteAt(services, key, true));
    const location = services.tree.locationFor(key);
    if (location) {
      add('locked-note', 'New locked note…', () => services.commands.newLocked(false, location));
      add('locked-sticky', 'New locked sticky…', () => services.commands.newLocked(true, location));
    }
    for (const [i, item] of documentCreation(services, key).entries()) items.push({ ...item, separatorBefore: i === 0 });
  };
  const favoriteToggle = (kind: 'project' | 'folder' | 'note' | 'document') => {
    if (!target.id) return;
    const id = target.id;
    add('favorite', target.favorite ? 'Remove from favorites' : 'Add to favorites', () => void tree.setFavorite(kind, id, !target.favorite).then((r) => report(services, r)));
  };
  const rename = () => add('rename', 'Rename', () => ui.requestFocus({ target: 'treeRename', key }));
  const trash = () => add('trash', 'Move to Trash', () => ui.openDialog({ kind: 'confirmTrash', key }));
  // The relation graph of the place (D-170).
  const graph = (scope: GraphScopeType) => add('graph', 'Open graph', () => void services.graph.open(scope));

  switch (target.kind) {
    case 'common':
      creation();
      add('folder', 'New folder', () => openNewFolderAt(services, key));
      graph({ kind: 'common' });
      break;
    case 'project':
      creation();
      add('folder', 'New folder', () => openNewFolderAt(services, key));
      rename();
      favoriteToggle('project');
      if (target.id) graph({ kind: 'project', projectId: target.id });
      trash();
      break;
    case 'folder':
      creation();
      add('folder', 'New folder', () => openNewFolderAt(services, key));
      rename();
      add('move', 'Move to…', () => ui.openDialog({ kind: 'move', key }));
      favoriteToggle('folder');
      if (target.id) graph({ kind: 'folder', folderId: target.id });
      trash();
      break;
    case 'note': {
      const noteId = target.id;
      add('open', 'Open', () => noteId && void openNoteFromTree(services, noteId));
      add('float', 'Float as sticky', () => noteId && void services.commands.float(noteId));
      rename();
      add('move', 'Move to…', () => ui.openDialog({ kind: 'move', key }));
      add('pin', target.pinned ? 'Unpin from Home' : 'Pin to Home', () => noteId && void tree.setPinned(noteId, !target.pinned).then((r) => report(services, r)));
      favoriteToggle('note');
      trash();
      break;
    }
    case 'document': {
      const documentId = target.id;
      if (!documentId) break;
      const run = (call: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
        void call().then((r) => {
          if (!r.ok && r.error) services.notices.push(r.error.message, 'error');
        });
      add('open', 'Open', () => void openDocumentFromTree(services, documentId));
      rename();
      add('move', 'Move to…', () => ui.openDialog({ kind: 'move', key }));
      favoriteToggle('document');
      if (target.documentKind !== 'html') add('external', 'Open in system app', () => run(() => services.bridge.document.openExternal({ documentId })));
      add('show', 'Show in folder', () => run(() => services.bridge.document.showInFolder({ documentId })));
      trash();
      break;
    }
    case 'trashItem': {
      const batchId = target.trash?.batchId;
      add('restore', 'Restore', () => batchId && void tree.restore(batchId).then((r) => report(services, r)));
      add('purge', 'Delete forever', () => batchId && ui.openDialog({ kind: 'confirmPurge', batchId, count: trashItemCount(target) }));
      break;
    }
    case 'group':
      if (target.key === 'trash') {
        const count = target.childKeys.reduce((n, k) => n + (model.nodes.get(k)?.kind === 'trashItem' ? trashItemCount(model.nodes.get(k)!) : 0), 0);
        add('empty', 'Empty trash', () => ui.openDialog({ kind: 'confirmEmptyTrash', count }), count === 0);
      } else if (target.key === 'projects') {
        add('project', 'New project', () => ui.openDialog({ kind: 'newProject' }));
      }
      break;
    default:
  }
  if (items.length === 0) return null;
  return <Menu items={items} anchor={menu.anchor} label={`${target.label} actions`} onClose={close} />;
}
