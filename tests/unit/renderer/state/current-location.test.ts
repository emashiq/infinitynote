import { describe, expect, it } from 'vitest';
import { resolveNewItemLocation, type LocationInput } from '../../../../src/renderer/state/current-location';
import type { FolderDtoType, NoteDtoType, ProjectDtoType } from '../../../../src/shared/contracts/hierarchy';
import { buildTreeModel } from '../../../../src/shared/tree/tree-model';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project: ProjectDtoType = { id: uid(1), name: 'P', favorite: false, createdAt: 1, updatedAt: 1 };
const l2: FolderDtoType = { id: uid(2), projectId: null, parentId: null, name: 'L2', favorite: false, createdAt: 1, updatedAt: 1 };
const l3: FolderDtoType = { id: uid(3), projectId: null, parentId: l2.id, name: 'L3', favorite: false, createdAt: 2, updatedAt: 2 };
const note: NoteDtoType = {
  id: uid(4),
  projectId: null,
  folderId: l2.id,
  title: 'N',
  sticky: false,
  color: null,
  pinnedAt: null,
  favorite: true,
  revision: 0,
  createdAt: 1,
  updatedAt: 1,
};
const model = buildTreeModel({ projects: [project], folders: [l2, l3], notes: [note] }, []);

const base = (over: Partial<LocationInput> = {}): LocationInput => ({
  treeHasFocus: false,
  selectedKey: null,
  model,
  activeTab: { id: 'home', kind: 'home' },
  activeNote: null,
  homeScope: { kind: 'all' },
  ...over,
});
const COMMON = { projectId: null, folderId: null };

describe('resolveNewItemLocation (INF-KEY-01, D-047)', () => {
  it('rule 1: a focused tree with a selection wins', () => {
    expect(resolveNewItemLocation(base({ treeHasFocus: true, selectedKey: `folder:${l3.id}` }))).toEqual({ projectId: null, folderId: l3.id });
    expect(resolveNewItemLocation(base({ treeHasFocus: true, selectedKey: `project:${project.id}` }))).toEqual({ projectId: project.id, folderId: null });
    expect(resolveNewItemLocation(base({ treeHasFocus: true, selectedKey: 'common' }))).toEqual(COMMON);
    expect(resolveNewItemLocation(base({ treeHasFocus: true, selectedKey: `note:${note.id}` }))).toEqual({ projectId: null, folderId: l2.id });
  });

  it('favorite entries resolve through their target', () => {
    expect(resolveNewItemLocation(base({ treeHasFocus: true, selectedKey: `fav:note:${note.id}` }))).toEqual({ projectId: null, folderId: l2.id });
  });

  it('group and trash selections fall through to the next rule', () => {
    const active = { id: `note:${note.id}`, kind: 'note' as const, noteId: note.id };
    for (const key of ['projects', 'trash', 'trash:empty', 'favorites']) {
      expect(resolveNewItemLocation(base({ treeHasFocus: true, selectedKey: key }))).toEqual(COMMON);
      expect(resolveNewItemLocation(base({ treeHasFocus: true, selectedKey: key, activeTab: active, activeNote: { projectId: null, folderId: l2.id } }))).toEqual({ projectId: null, folderId: l2.id });
    }
  });

  it('an unfocused tree is ignored', () => {
    expect(resolveNewItemLocation(base({ treeHasFocus: false, selectedKey: `folder:${l3.id}` }))).toEqual(COMMON);
  });

  it('rule 2: the active note tab uses the note location', () => {
    const active = { id: `note:${note.id}`, kind: 'note' as const, noteId: note.id };
    expect(resolveNewItemLocation(base({ activeTab: active, activeNote: { projectId: null, folderId: l2.id } }))).toEqual({ projectId: null, folderId: l2.id });
    expect(resolveNewItemLocation(base({ activeTab: active, activeNote: null }))).toEqual(COMMON);
  });

  it('rule 3: Home uses the project root for a Project scope, else Common', () => {
    expect(resolveNewItemLocation(base({ homeScope: { kind: 'project', projectId: project.id } }))).toEqual({ projectId: project.id, folderId: null });
    expect(resolveNewItemLocation(base({ homeScope: { kind: 'common' } }))).toEqual(COMMON);
    expect(resolveNewItemLocation(base({ homeScope: { kind: 'all' } }))).toEqual(COMMON);
  });

  it('rule 4: other tabs use the Common root, even with a Project scope', () => {
    expect(resolveNewItemLocation(base({ activeTab: { id: 'page:settings', kind: 'settings' }, homeScope: { kind: 'project', projectId: project.id } }))).toEqual(COMMON);
    expect(resolveNewItemLocation(base({ activeTab: { id: 'page:stickies', kind: 'stickies' } }))).toEqual(COMMON);
  });
});
