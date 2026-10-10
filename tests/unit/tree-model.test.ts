import { describe, expect, it } from 'vitest';
import type { FolderDtoType, NoteDtoType, ProjectDtoType, TrashItemType, TreeSnapshotType } from '../../src/shared/contracts/hierarchy';
import {
  ancestorsOf,
  buildTreeModel,
  flattenVisible,
  locationOfNode,
  treeKeyAction,
  type NodeKey,
} from '../../src/shared/tree/tree-model';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = (n: number, name: string, extra: Partial<ProjectDtoType> = {}): ProjectDtoType => ({ id: uid(n), name, favorite: false, createdAt: n, updatedAt: n, ...extra });
const folder = (n: number, name: string, projectId: string | null, parentId: string | null, extra: Partial<FolderDtoType> = {}): FolderDtoType => ({
  id: uid(n),
  projectId,
  parentId,
  name,
  favorite: false,
  createdAt: n,
  updatedAt: n,
  ...extra,
});
const note = (n: number, title: string, projectId: string | null, folderId: string | null, extra: Partial<NoteDtoType> = {}): NoteDtoType => ({
  id: uid(n),
  projectId,
  folderId,
  title,
  sticky: false,
  color: null,
  pinnedAt: null,
  favorite: false,
  revision: 0,
  locked: false,
  createdAt: n,
  updatedAt: n,
  ...extra,
});
const snap = (s: Partial<TreeSnapshotType>): TreeSnapshotType => ({ projects: [], folders: [], notes: [], documents: [], ...s });
const labels = (m: ReturnType<typeof buildTreeModel>, key: NodeKey) => m.nodes.get(key)!.childKeys.map((k) => m.nodes.get(k)!.label);

describe('buildTreeModel', () => {
  it('has Common, Projects and Trash roots in order, and Favorites only when something is favorited', () => {
    const m = buildTreeModel(snap({}), []);
    expect(m.roots).toEqual(['common', 'projects', 'trash']);
    const withFav = buildTreeModel(snap({ notes: [note(1, 'N', null, null, { favorite: true })] }), []);
    expect(withFav.roots).toEqual(['favorites', 'common', 'projects', 'trash']);
    expect(labels(withFav, 'favorites')).toEqual(['N']);
    expect(withFav.nodes.get(`fav:note:${uid(1)}`)!.targetKey).toBe(`note:${uid(1)}`);
  });

  it('places folders before notes and sorts with a numeric, case-insensitive collation', () => {
    const m = buildTreeModel(
      snap({
        folders: [folder(1, 'b folder', null, null), folder(2, 'A folder', null, null)],
        notes: [note(3, 'a10', null, null), note(4, 'a2', null, null), note(5, 'B', null, null), note(6, '', null, null)],
      }),
      [],
    );
    expect(labels(m, 'common')).toEqual(['A folder', 'b folder', 'a2', 'a10', 'B', 'Untitled']);
  });

  it('keeps Bangla ordering stable', () => {
    const names = ['ক', 'খ', 'অ', 'আ'];
    const a = buildTreeModel(snap({ notes: names.map((t, i) => note(i + 1, t, null, null)) }), []);
    const b = buildTreeModel(snap({ notes: [...names].reverse().map((t, i) => note(i + 10, t, null, null)) }), []);
    expect(labels(a, 'common')).toEqual(labels(b, 'common'));
  });

  it('nests folders under projects and parents, notes under folders, and breaks ties by createdAt', () => {
    const p = project(1, 'Work');
    const f1 = folder(2, 'Specs', p.id, null);
    const f2 = folder(3, '2026', p.id, f1.id);
    const m = buildTreeModel(
      snap({ projects: [p], folders: [f1, f2], notes: [note(4, 'Plan', p.id, f2.id), note(5, 'Plan', p.id, f2.id, { createdAt: 0 })] }),
      [],
    );
    expect(m.nodes.get(`project:${p.id}`)!.childKeys).toEqual([`folder:${f1.id}`]);
    expect(m.nodes.get(`folder:${f1.id}`)!.childKeys).toEqual([`folder:${f2.id}`]);
    expect(m.nodes.get(`folder:${f2.id}`)!.childKeys).toEqual([`note:${uid(5)}`, `note:${uid(4)}`]);
    expect(ancestorsOf(m, `note:${uid(4)}`)).toEqual([`folder:${f2.id}`, `folder:${f1.id}`, `project:${p.id}`, 'projects']);
  });

  it('shows a Trash is empty row, or trash items newest first', () => {
    const empty = buildTreeModel(snap({}), []);
    expect(labels(empty, 'trash')).toEqual(['Trash is empty']);
    expect(empty.nodes.get('trash:empty')!.kind).toBe('empty');
    const item = (n: number, deletedAt: number): TrashItemType => ({
      batchId: uid(n),
      kind: 'note',
      id: uid(n + 100),
      label: `t${n}`,
      sticky: false,
      deletedAt,
      fromPath: ['Common'],
      contains: { folders: 0, notes: 0, documents: 0 },
      documentKind: null,
    });
    const m = buildTreeModel(snap({}), [item(1, 10), item(2, 20)]);
    expect(labels(m, 'trash')).toEqual(['t2', 't1']);
    expect(m.nodes.get(`trash:${uid(1)}`)!.kind).toBe('trashItem');
  });

  it('locationOfNode covers every kind', () => {
    const p = project(1, 'Work');
    const f = folder(2, 'F', p.id, null);
    const n = note(3, 'N', p.id, f.id, { favorite: true });
    const m = buildTreeModel(snap({ projects: [p], folders: [f], notes: [n] }), []);
    expect(locationOfNode(m, 'common')).toEqual({ projectId: null, folderId: null });
    expect(locationOfNode(m, `project:${p.id}`)).toEqual({ projectId: p.id, folderId: null });
    expect(locationOfNode(m, `folder:${f.id}`)).toEqual({ projectId: p.id, folderId: f.id });
    expect(locationOfNode(m, `note:${n.id}`)).toEqual({ projectId: p.id, folderId: f.id });
    expect(locationOfNode(m, `fav:note:${n.id}`)).toEqual({ projectId: p.id, folderId: f.id });
    for (const k of ['projects', 'trash', 'favorites', 'trash:empty', 'nope']) expect(locationOfNode(m, k), k).toBeNull();
  });
});

describe('flattenVisible and keyboard actions', () => {
  const p = project(1, 'Work');
  const f = folder(2, 'F', p.id, null);
  const n = note(3, 'N', p.id, f.id);
  const m = buildTreeModel(snap({ projects: [p], folders: [f], notes: [n] }), []);
  const open = (...keys: string[]) => new Set<NodeKey>(keys);

  it('reports level, posinset, setsize and expansion', () => {
    const rows = flattenVisible(m, open('common', 'projects', `project:${p.id}`, `folder:${f.id}`));
    expect(rows.map((r) => r.key)).toEqual(['common', 'projects', `project:${p.id}`, `folder:${f.id}`, `note:${n.id}`, 'trash']);
    expect(rows[0]).toMatchObject({ level: 1, posInSet: 1, setSize: 3, hasChildren: false, expanded: false });
    expect(rows[2]).toMatchObject({ level: 2, posInSet: 1, setSize: 1, hasChildren: true, expanded: true });
    expect(rows[4]).toMatchObject({ level: 4, posInSet: 1, setSize: 1, hasChildren: false });
    expect(flattenVisible(m, open()).map((r) => r.key)).toEqual(['common', 'projects', 'trash']);
  });

  it('follows the APG rules', () => {
    const rows = flattenVisible(m, open('projects', `project:${p.id}`));
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual(['common', 'projects', `project:${p.id}`, `folder:${f.id}`, 'trash']);
    expect(treeKeyAction(rows, 'common', 'ArrowDown')).toEqual({ focus: 'projects' });
    expect(treeKeyAction(rows, 'projects', 'ArrowUp')).toEqual({ focus: 'common' });
    expect(treeKeyAction(rows, 'common', 'ArrowUp')).toEqual({});
    expect(treeKeyAction(rows, 'trash', 'ArrowDown')).toEqual({});
    expect(treeKeyAction(rows, 'projects', 'Home')).toEqual({ focus: 'common' });
    expect(treeKeyAction(rows, 'common', 'End')).toEqual({ focus: 'trash' });
    // Right: leaf does nothing, collapsed parent expands, expanded parent goes to first child
    expect(treeKeyAction(rows, 'common', 'ArrowRight')).toEqual({});
    expect(treeKeyAction(rows, `folder:${f.id}`, 'ArrowRight')).toEqual({ expand: `folder:${f.id}` });
    expect(treeKeyAction(rows, 'projects', 'ArrowRight')).toEqual({ focus: `project:${p.id}` });
    // Left: expanded collapses, child goes to parent, root leaf does nothing
    expect(treeKeyAction(rows, 'projects', 'ArrowLeft')).toEqual({ collapse: 'projects' });
    expect(treeKeyAction(rows, `folder:${f.id}`, 'ArrowLeft')).toEqual({ focus: `project:${p.id}` });
    expect(treeKeyAction(rows, 'common', 'ArrowLeft')).toEqual({});
    expect(treeKeyAction(rows, 'common', 'x')).toEqual({});
    expect(treeKeyAction([], null, 'ArrowDown')).toEqual({});
    expect(treeKeyAction(rows, null, 'ArrowDown')).toEqual({ focus: 'common' });
  });
});
