import type { LocationType, NoteColorType, TreeSnapshotType, TrashItemType } from '../contracts/hierarchy';
import { COMMON_LABEL, displayTitle } from '../names';

export type NodeKey = string;

export type NodeKind = 'group' | 'common' | 'project' | 'folder' | 'note' | 'favorite' | 'trashItem' | 'empty';

export interface TreeNode {
  key: NodeKey;
  kind: NodeKind;
  id?: string;
  label: string;
  sticky?: boolean;
  color?: NoteColorType | null;
  pinned?: boolean;
  favorite?: boolean;
  /** For favorite entries: the kind of the underlying item. */
  entity?: 'project' | 'folder' | 'note';
  parentKey: NodeKey | null;
  childKeys: NodeKey[];
  /** Where items created at this node go (Common, project, folder and note nodes). */
  location?: LocationType;
  targetKey?: NodeKey;
  trash?: TrashItemType;
}

export interface TreeModel {
  nodes: Map<NodeKey, TreeNode>;
  roots: NodeKey[];
}

export interface VisibleRow {
  key: NodeKey;
  level: number;
  posInSet: number;
  setSize: number;
  hasChildren: boolean;
  expanded: boolean;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

interface Sortable {
  key: NodeKey;
  label: string;
  createdAt: number;
  id: string;
}
function sortKeys(list: Sortable[]): NodeKey[] {
  return [...list]
    .sort((a, b) => collator.compare(a.label, b.label) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((s) => s.key);
}

export function buildTreeModel(snapshot: TreeSnapshotType, trashItems: readonly TrashItemType[]): TreeModel {
  const nodes = new Map<NodeKey, TreeNode>();
  const add = (n: Omit<TreeNode, 'childKeys'> & { childKeys?: NodeKey[] }): TreeNode => {
    const node: TreeNode = { childKeys: [], ...n };
    nodes.set(node.key, node);
    return node;
  };

  add({ key: 'common', kind: 'common', label: COMMON_LABEL, parentKey: null, location: { projectId: null, folderId: null } });
  const projectsGroup = add({ key: 'projects', kind: 'group', label: 'Projects', parentKey: null });
  const trashGroup = add({ key: 'trash', kind: 'group', label: 'Trash', parentKey: null });

  const push = (lists: Map<NodeKey, Sortable[]>, parent: NodeKey, s: Sortable) => {
    const l = lists.get(parent);
    if (l) l.push(s);
    else lists.set(parent, [s]);
  };

  const projectSort: Sortable[] = [];
  for (const p of snapshot.projects) {
    const key = `project:${p.id}`;
    add({
      key,
      kind: 'project',
      id: p.id,
      label: p.name,
      favorite: p.favorite,
      parentKey: 'projects',
      location: { projectId: p.id, folderId: null },
    });
    projectSort.push({ key, label: p.name, createdAt: p.createdAt, id: p.id });
  }
  projectsGroup.childKeys = sortKeys(projectSort);

  const folderKeys = new Set(snapshot.folders.map((f) => `folder:${f.id}`));
  const scopeKey = (projectId: string | null) => (projectId === null ? 'common' : `project:${projectId}`);
  // Under each parent: folders first, then notes, each sorted by label.
  const folderSort = new Map<NodeKey, Sortable[]>();
  for (const f of snapshot.folders) {
    const key = `folder:${f.id}`;
    const parentKey = f.parentId !== null && folderKeys.has(`folder:${f.parentId}`) ? `folder:${f.parentId}` : scopeKey(f.projectId);
    add({
      key,
      kind: 'folder',
      id: f.id,
      label: f.name,
      favorite: f.favorite,
      parentKey,
      location: { projectId: f.projectId, folderId: f.id },
    });
    push(folderSort, parentKey, { key, label: f.name, createdAt: f.createdAt, id: f.id });
  }
  const noteSort = new Map<NodeKey, Sortable[]>();
  for (const n of snapshot.notes) {
    const key = `note:${n.id}`;
    const parentKey = n.folderId !== null && folderKeys.has(`folder:${n.folderId}`) ? `folder:${n.folderId}` : scopeKey(n.projectId);
    const label = displayTitle(n.title);
    add({
      key,
      kind: 'note',
      id: n.id,
      label,
      sticky: n.sticky,
      color: n.color,
      pinned: n.pinnedAt !== null,
      favorite: n.favorite,
      parentKey,
      location: { projectId: n.projectId, folderId: n.folderId },
    });
    push(noteSort, parentKey, { key, label, createdAt: n.createdAt, id: n.id });
  }
  for (const [parent, list] of folderSort) {
    const node = nodes.get(parent);
    if (node) node.childKeys = sortKeys(list);
  }
  for (const [parent, list] of noteSort) {
    const node = nodes.get(parent);
    if (node) node.childKeys = [...node.childKeys, ...sortKeys(list)];
  }
  // trash
  const sortedTrash = [...trashItems].sort((a, b) => b.deletedAt - a.deletedAt || (a.batchId < b.batchId ? -1 : 1));
  for (const t of sortedTrash) {
    const key = `trash:${t.batchId}`;
    add({
      key,
      kind: 'trashItem',
      id: t.batchId,
      label: t.kind === 'note' ? displayTitle(t.label) : t.label,
      sticky: t.sticky,
      entity: t.kind,
      parentKey: 'trash',
      trash: t,
    });
    trashGroup.childKeys.push(key);
  }
  if (trashGroup.childKeys.length === 0) {
    add({ key: 'trash:empty', kind: 'empty', label: 'Trash is empty', parentKey: 'trash' });
    trashGroup.childKeys.push('trash:empty');
  }

  // favorites
  const favSort: Sortable[] = [];
  const addFav = (entity: 'project' | 'folder' | 'note', id: string, label: string, createdAt: number, extra: Partial<TreeNode>) => {
    const key = `fav:${entity}:${id}`;
    add({
      key,
      kind: 'favorite',
      id,
      label,
      entity,
      parentKey: 'favorites',
      targetKey: `${entity}:${id}`,
      ...extra,
    });
    favSort.push({ key, label, createdAt, id });
  };
  for (const p of snapshot.projects) if (p.favorite) addFav('project', p.id, p.name, p.createdAt, {});
  for (const f of snapshot.folders) if (f.favorite) addFav('folder', f.id, f.name, f.createdAt, {});
  for (const n of snapshot.notes) {
    if (n.favorite) addFav('note', n.id, displayTitle(n.title), n.createdAt, { sticky: n.sticky, color: n.color });
  }
  const roots: NodeKey[] = [];
  if (favSort.length > 0) {
    add({ key: 'favorites', kind: 'group', label: 'Favorites', parentKey: null, childKeys: sortKeys(favSort) });
    roots.push('favorites');
  }
  roots.push('common', 'projects', 'trash');
  return { nodes, roots };
}

export function flattenVisible(model: TreeModel, expanded: ReadonlySet<NodeKey>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const walk = (keys: readonly NodeKey[], level: number) => {
    keys.forEach((key, i) => {
      const node = model.nodes.get(key);
      if (!node) return;
      const hasChildren = node.childKeys.length > 0;
      const isExpanded = hasChildren && expanded.has(key);
      rows.push({ key, level, posInSet: i + 1, setSize: keys.length, hasChildren, expanded: isExpanded });
      if (isExpanded) walk(node.childKeys, level + 1);
    });
  };
  walk(model.roots, 1);
  return rows;
}

export interface TreeKeyResult {
  focus?: NodeKey;
  expand?: NodeKey;
  collapse?: NodeKey;
}

export function treeKeyAction(rows: readonly VisibleRow[], currentKey: NodeKey | null, key: string): TreeKeyResult {
  if (rows.length === 0) return {};
  const idx = currentKey === null ? -1 : rows.findIndex((r) => r.key === currentKey);
  if (key === 'Home') return { focus: rows[0]!.key };
  if (key === 'End') return { focus: rows[rows.length - 1]!.key };
  if (idx < 0) {
    return key === 'ArrowDown' || key === 'ArrowUp' || key === 'ArrowRight' || key === 'ArrowLeft' ? { focus: rows[0]!.key } : {};
  }
  const row = rows[idx]!;
  switch (key) {
    case 'ArrowDown':
      return idx + 1 < rows.length ? { focus: rows[idx + 1]!.key } : {};
    case 'ArrowUp':
      return idx > 0 ? { focus: rows[idx - 1]!.key } : {};
    case 'ArrowRight':
      if (!row.hasChildren) return {};
      if (!row.expanded) return { expand: row.key };
      return idx + 1 < rows.length && rows[idx + 1]!.level === row.level + 1 ? { focus: rows[idx + 1]!.key } : {};
    case 'ArrowLeft': {
      if (row.hasChildren && row.expanded) return { collapse: row.key };
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (rows[i]!.level < row.level) return { focus: rows[i]!.key };
      }
      return {};
    }
    default:
      return {};
  }
}

/** Keys of all ancestors of `key`, nearest first, ending at a root. */
export function ancestorsOf(model: TreeModel, key: NodeKey): NodeKey[] {
  const out: NodeKey[] = [];
  let cur = model.nodes.get(key);
  let guard = 0;
  while (cur && cur.parentKey !== null && guard < 100) {
    out.push(cur.parentKey);
    cur = model.nodes.get(cur.parentKey);
    guard += 1;
  }
  return out;
}

/** Where a new item created "at" this node goes. Null for groups and trash nodes. */
export function locationOfNode(model: TreeModel, key: NodeKey): LocationType | null {
  const node = model.nodes.get(key);
  if (!node) return null;
  if (node.kind === 'favorite') return node.targetKey ? locationOfNode(model, node.targetKey) : null;
  if (node.kind === 'common' || node.kind === 'project' || node.kind === 'folder' || node.kind === 'note') {
    return node.location ?? null;
  }
  return null;
}
