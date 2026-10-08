import { FolderPlus } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { normalizeName, validateName, validateTitle } from '../../shared/names';
import { flattenVisible, treeKeyAction, type TreeNode } from '../../shared/tree/tree-model';
import { useServices, useStore } from '../state/use-store';
import { IconButton } from '../ui/IconButton';
import { effectiveKey, openNoteFromTree, trashItemCount } from './actions';
import { TreeContextMenu } from './TreeContextMenu';
import { TreeRow } from './TreeRow';

export function TreePane() {
  const services = useServices();
  const { tree, ui, notices } = services;
  const state = useStore(tree.store);
  const uiState = useStore(ui.store);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => flattenVisible(state.model, state.expanded), [state.model, state.expanded]);
  const rovingKey = rows.some((r) => r.key === activeKey)
    ? activeKey
    : rows.some((r) => r.key === state.selectedKey)
      ? state.selectedKey
      : (rows[0]?.key ?? null);

  const focusKey = (key: string) => {
    const el = document.getElementById(`tree-${key}`);
    if (el) el.focus();
    else pendingFocus.current = key;
  };

  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    const el = document.getElementById(`tree-${key}`);
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  });

  // Focus requests: the Notes rail button and the move dialog ask for tree focus; menus ask for inline rename.
  const request = uiState.focusRequest;
  useEffect(() => {
    if (request?.target !== 'tree') return;
    const key = state.selectedKey && rows.some((r) => r.key === state.selectedKey) ? state.selectedKey : (rows[0]?.key ?? null);
    if (!key) return;
    ui.consumeFocus();
    document.getElementById(`tree-${key}`)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, rows]);

  useEffect(
    () =>
      ui.store.subscribe(() => {
        const next = ui.store.getState().focusRequest;
        if (next?.target === 'treeRename') {
          ui.consumeFocus();
          setRenamingKey(next.key);
        }
      }),
    [ui],
  );

  const nodeFor = (key: string): TreeNode | undefined => state.model.nodes.get(key);

  const activate = (node: TreeNode) => {
    if (node.kind === 'empty') return;
    const real = state.model.nodes.get(effectiveKey(node)) ?? node;
    if (node.kind === 'favorite') tree.reveal(node.key);
    else tree.select(node.key);
    if (real.kind === 'note' && real.id) void openNoteFromTree(services, real.id);
    else if (node.kind !== 'favorite' && node.kind !== 'trashItem' && node.childKeys.length > 0) tree.toggle(node.key);
  };

  const menuAt = (key: string, x: number, y: number) => ui.openMenu(key, { x, y });

  const onRowClick = (node: TreeNode) => (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('input')) return;
    focusKey(node.key);
    activate(node);
  };
  const onRowContext = (node: TreeNode) => (e: MouseEvent) => {
    e.preventDefault();
    focusKey(node.key);
    tree.select(node.key);
    menuAt(node.key, e.clientX, e.clientY);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT') return;
    const li = target.closest('li');
    const key = li?.dataset.key ?? rovingKey;
    if (!key) return;
    const node = nodeFor(key);
    if (!node) return;

    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const rect = (li ?? target).getBoundingClientRect();
      menuAt(key, rect.left + 24, rect.bottom);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (node.kind === 'trashItem') {
        const rect = (li ?? target).getBoundingClientRect();
        menuAt(key, rect.left + 24, rect.bottom);
      } else activate(node);
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      if (node.kind === 'common') notices.push('Common cannot be renamed', 'info');
      else if (node.kind === 'project' || node.kind === 'folder' || node.kind === 'note') setRenamingKey(key);
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      if (node.kind === 'common') notices.push('Common cannot be moved to Trash', 'info');
      else if (node.kind === 'trashItem' && node.trash) ui.openDialog({ kind: 'confirmPurge', batchId: node.trash.batchId, count: trashItemCount(node) });
      else if (node.kind === 'project' || node.kind === 'folder' || node.kind === 'note') ui.openDialog({ kind: 'confirmTrash', key });
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const result = treeKeyAction(rows, key, e.key);
      if (result.expand) tree.setExpanded(result.expand, true);
      if (result.collapse) tree.setExpanded(result.collapse, false);
      if (result.focus) {
        tree.select(result.focus);
        focusKey(result.focus);
      }
    }
  };

  const initialName = (node: TreeNode): string => {
    if (node.kind !== 'note') return node.label;
    return state.snapshot.notes.find((n) => n.id === node.id)?.title ?? '';
  };

  const commitRename = (node: TreeNode) => async (value: string): Promise<string | null> => {
    const real = state.model.nodes.get(effectiveKey(node)) ?? node;
    const id = real.id;
    if (!id) return null;
    const next = normalizeName(value);
    const message = real.kind === 'note' ? validateTitle(next) : validateName(next);
    if (message) return message;
    if (next === initialName(real)) {
      setRenamingKey(null);
      focusKey(node.key);
      return null;
    }
    const res =
      real.kind === 'project' ? await tree.renameProject(id, next) : real.kind === 'folder' ? await tree.renameFolder(id, next) : await tree.renameNote(id, next);
    if (!res.ok) return res.message;
    setRenamingKey(null);
    focusKey(node.key);
    return null;
  };

  return (
    <nav className="tree-pane" id="tree-pane" aria-label="Notes">
      <div className="pane-header">
        <span className="section-label pane-title">Notes</span>
        <IconButton label="New project" icon={FolderPlus} onClick={() => ui.openDialog({ kind: 'newProject' })} />
      </div>
      {state.status === 'error' ? (
        <p role="alert" className="pane-message">
          {state.error ?? 'Could not load notes.'}
        </p>
      ) : (
        <ul
          ref={listRef}
          role="tree"
          aria-label="Notes tree"
          className="tree"
          aria-busy={state.status === 'loading'}
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            tree.setHasFocus(true);
            const key = (e.target as HTMLElement).closest('li')?.dataset.key;
            if (key) setActiveKey(key);
          }}
          onBlur={(e) => {
            if (!listRef.current?.contains(e.relatedTarget as Node | null)) tree.setHasFocus(false);
          }}
        >
          {rows.map((row) => {
            const node = state.model.nodes.get(row.key);
            if (!node) return null;
            return (
              <TreeRow
                key={row.key}
                node={node}
                row={row}
                selected={state.selectedKey === row.key}
                rovingFocus={rovingKey === row.key}
                renaming={renamingKey === row.key}
                renameInitial={initialName(state.model.nodes.get(effectiveKey(node)) ?? node)}
                onRenameCommit={commitRename(node)}
                onRenameCancel={() => {
                  setRenamingKey(null);
                  focusKey(row.key);
                }}
                onClick={onRowClick(node)}
                onContextMenu={onRowContext(node)}
              />
            );
          })}
        </ul>
      )}
      <TreeContextMenu />
    </nav>
  );
}

