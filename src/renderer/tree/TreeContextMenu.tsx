import { useServices, useStore } from '../state/use-store';
import { Menu, type MenuItem } from '../ui/Menu';
import { createNoteAt, effectiveKey, openNewFolderAt, openNoteFromTree, report, trashItemCount } from './actions';

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
  };
  const favoriteToggle = (kind: 'project' | 'folder' | 'note') => {
    if (!target.id) return;
    const id = target.id;
    add('favorite', target.favorite ? 'Remove from favorites' : 'Add to favorites', () => void tree.setFavorite(kind, id, !target.favorite).then((r) => report(services, r)));
  };
  const rename = () => add('rename', 'Rename', () => ui.requestFocus({ target: 'treeRename', key }));
  const trash = () => add('trash', 'Move to Trash', () => ui.openDialog({ kind: 'confirmTrash', key }));

  switch (target.kind) {
    case 'common':
      creation();
      add('folder', 'New folder', () => openNewFolderAt(services, key));
      break;
    case 'project':
      creation();
      add('folder', 'New folder', () => openNewFolderAt(services, key));
      rename();
      favoriteToggle('project');
      trash();
      break;
    case 'folder':
      creation();
      add('folder', 'New folder', () => openNewFolderAt(services, key));
      rename();
      add('move', 'Move to…', () => ui.openDialog({ kind: 'move', key }));
      favoriteToggle('folder');
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
