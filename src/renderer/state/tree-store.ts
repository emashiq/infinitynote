import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { ErrorEnvelope, Result } from '../../shared/contracts/envelope';
import type {
  FolderTargetType,
  ItemKindType,
  LocationType,
  NoteDtoType,
  TreeChangedEventType,
  TreeSnapshotType,
  TrashItemType,
  TrashResultType,
  TrashRestoreResponseType,
} from '../../shared/contracts/hierarchy';
import { buildPathIndex, pathOf } from '../../shared/tree/paths';
import { ancestorsOf, buildTreeModel, locationOfNode, type NodeKey, type TreeModel } from '../../shared/tree/tree-model';
import { closedTabsNotice, type NoticeStore } from './notice-store';
import { createDebouncer, createStore, failOutcome, okOutcome, type Outcome, type Store, type Timers } from './store';
import type { TabsStore } from './tabs-store';

export interface TreeState {
  status: 'loading' | 'ready' | 'error';
  snapshot: TreeSnapshotType;
  trash: TrashItemType[];
  model: TreeModel;
  expanded: Set<NodeKey>;
  selectedKey: NodeKey | null;
  hasFocus: boolean;
  error?: string;
}

export interface MoveDestination {
  key: NodeKey;
  path: string[];
  projectId: string | null;
  /** Folder id for note moves, parent folder id for folder moves. */
  folderId: string | null;
  current: boolean;
}

export const EXPANDED_DEBOUNCE_MS = 300;
const EMPTY_SNAPSHOT: TreeSnapshotType = { projects: [], folders: [], notes: [] };
const EXPANDABLE = /^(common|projects|favorites|trash|(project|folder):[0-9a-f-]{36})$/;

export interface TreeDeps {
  bridge: InfinityBridge;
  tabs: TabsStore;
  notices: NoticeStore;
  timers: Timers;
}

export class TreeStore {
  readonly store: Store<TreeState>;
  private reloading: Promise<void> | null = null;
  private reloadAgain = false;
  private readonly expandedTimer;

  constructor(private readonly deps: TreeDeps) {
    this.store = createStore<TreeState>({
      status: 'loading',
      snapshot: EMPTY_SNAPSHOT,
      trash: [],
      model: buildTreeModel(EMPTY_SNAPSHOT, []),
      expanded: new Set(['common', 'projects']),
      selectedKey: null,
      hasFocus: false,
    });
    this.expandedTimer = createDebouncer(deps.timers, EXPANDED_DEBOUNCE_MS, () => this.persistExpanded());
  }

  hydrate(expanded: readonly string[]): void {
    this.store.setState({ expanded: new Set(expanded) });
  }

  // Loading -----------------------------------------------------------------------
  reload(): Promise<void> {
    if (this.reloading) {
      this.reloadAgain = true;
      return this.reloading;
    }
    this.reloading = (async () => {
      try {
        do {
          this.reloadAgain = false;
          const [tree, trash] = await Promise.all([this.deps.bridge.tree.list(), this.deps.bridge.trash.list()]);
          if (tree.ok && trash.ok) {
            this.store.setState({
              status: 'ready',
              snapshot: tree.data,
              trash: trash.data.items,
              model: buildTreeModel(tree.data, trash.data.items),
              error: undefined,
            });
          } else {
            const message = !tree.ok ? tree.error.message : !trash.ok ? trash.error.message : 'Unknown error';
            this.store.setState({ status: 'error', error: message });
          }
        } while (this.reloadAgain);
      } finally {
        this.reloading = null;
      }
    })();
    return this.reloading;
  }

  /** Handles tree:changed from main: reload, and close tabs of notes that were trashed. */
  async handleChanged(event: TreeChangedEventType): Promise<void> {
    const closing = event.trashedNoteIds.length > 0 ? this.deps.tabs.closeNoteTabs(event.trashedNoteIds) : Promise.resolve(0);
    const [removed] = await Promise.all([closing, this.reload()]);
    if (removed > 0) this.deps.notices.push(closedTabsNotice(removed, false), 'info');
  }

  // Selection and expansion ---------------------------------------------------------
  select(key: NodeKey | null): void {
    this.store.setState({ selectedKey: key });
  }
  setHasFocus(hasFocus: boolean): void {
    if (this.store.getState().hasFocus !== hasFocus) this.store.setState({ hasFocus });
  }

  private persistExpanded(): void {
    const { expanded, model } = this.store.getState();
    const keys = [...expanded].filter((k) => EXPANDABLE.test(k) && model.nodes.has(k)).sort();
    void this.deps.bridge.settings.set({ key: 'tree.expanded', value: keys.slice(0, 5000) });
  }

  setExpanded(key: NodeKey, open: boolean): void {
    const { expanded } = this.store.getState();
    if (expanded.has(key) === open) return;
    const next = new Set(expanded);
    if (open) next.add(key);
    else next.delete(key);
    this.store.setState({ expanded: next });
    this.expandedTimer.schedule();
  }
  toggle(key: NodeKey): void {
    this.setExpanded(key, !this.store.getState().expanded.has(key));
  }

  /** Expands every ancestor of the node and selects it. */
  reveal(key: NodeKey): void {
    const { model, expanded } = this.store.getState();
    const node = model.nodes.get(key);
    const target = node?.kind === 'favorite' && node.targetKey ? node.targetKey : key;
    const next = new Set(expanded);
    for (const a of ancestorsOf(model, target)) next.add(a);
    this.store.setState({ expanded: next, selectedKey: key });
    this.expandedTimer.schedule();
  }

  locationFor(key: NodeKey): LocationType | null {
    return locationOfNode(this.store.getState().model, key);
  }

  // Helpers -----------------------------------------------------------------------
  private fail(res: { error: ErrorEnvelope }): Outcome<never> {
    return failOutcome(res.error.code, res.error.message);
  }

  private async afterChange(revealKey?: NodeKey): Promise<void> {
    await this.reload();
    if (revealKey) this.reveal(revealKey);
  }

  // Create ------------------------------------------------------------------------
  async createProject(name: string): Promise<Outcome<{ id: string }>> {
    const res = await this.deps.bridge.project.create({ name });
    if (!res.ok) return this.fail(res);
    const key = `project:${res.data.project.id}`;
    await this.afterChange(key);
    this.setExpanded(key, true);
    return okOutcome({ id: res.data.project.id });
  }

  async createFolder(target: FolderTargetType, name: string): Promise<Outcome<{ id: string }>> {
    const res = await this.deps.bridge.folder.create({ location: target, name });
    if (!res.ok) return this.fail(res);
    await this.afterChange(`folder:${res.data.folder.id}`);
    return okOutcome({ id: res.data.folder.id });
  }

  async createNote(location: LocationType, opts: { sticky: boolean; title?: string; format?: 'rich' | 'plain' }): Promise<Outcome<{ note: NoteDtoType }>> {
    const res = await this.deps.bridge.note.create({
      location,
      sticky: opts.sticky,
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.format !== undefined ? { format: opts.format } : {}),
    });
    if (!res.ok) return this.fail(res);
    await this.afterChange(`note:${res.data.note.id}`);
    return okOutcome({ note: res.data.note });
  }

  // Rename / move -----------------------------------------------------------------
  async renameProject(projectId: string, name: string): Promise<Outcome> {
    const res = await this.deps.bridge.project.rename({ projectId, name });
    if (!res.ok) return this.fail(res);
    await this.afterChange();
    return okOutcome(undefined);
  }
  async renameFolder(folderId: string, name: string): Promise<Outcome> {
    const res = await this.deps.bridge.folder.rename({ folderId, name });
    if (!res.ok) return this.fail(res);
    await this.afterChange();
    return okOutcome(undefined);
  }
  async renameNote(noteId: string, title: string): Promise<Outcome> {
    const res = await this.deps.bridge.note.rename({ noteId, title });
    if (!res.ok) return this.fail(res);
    await this.afterChange();
    return okOutcome(undefined);
  }
  async moveFolder(folderId: string, target: FolderTargetType): Promise<Outcome> {
    const res = await this.deps.bridge.folder.move({ folderId, target });
    if (!res.ok) return this.fail(res);
    await this.afterChange(`folder:${folderId}`);
    return okOutcome(undefined);
  }
  async moveNote(noteId: string, target: LocationType): Promise<Outcome> {
    const res = await this.deps.bridge.note.move({ noteId, target });
    if (!res.ok) return this.fail(res);
    await this.afterChange(`note:${noteId}`);
    return okOutcome(undefined);
  }

  /** Moves the folder or note behind `key` to a destination from moveDestinations(). */
  moveItem(key: NodeKey, dest: MoveDestination): Promise<Outcome> {
    const node = this.store.getState().model.nodes.get(key);
    if (node?.kind === 'folder' && node.id) return this.moveFolder(node.id, { projectId: dest.projectId, parentId: dest.folderId });
    if (node?.kind === 'note' && node.id) return this.moveNote(node.id, { projectId: dest.projectId, folderId: dest.folderId });
    return Promise.resolve(failOutcome('NOT_FOUND', 'That item no longer exists.'));
  }

  /** All live move targets in display order: Common root, Common folders, then each project root and its folders. */
  moveDestinations(forKey: NodeKey): MoveDestination[] {
    const { model, snapshot } = this.store.getState();
    const node = model.nodes.get(forKey);
    const index = buildPathIndex(snapshot.projects, snapshot.folders);
    const folder = node?.kind === 'folder' && node.id ? snapshot.folders.find((f) => f.id === node.id) : undefined;
    const note = node?.kind === 'note' && node.id ? snapshot.notes.find((n) => n.id === node.id) : undefined;
    const isCurrent = (projectId: string | null, folderId: string | null): boolean => {
      if (folder) return folder.projectId === projectId && folder.parentId === folderId;
      if (note) return note.projectId === projectId && note.folderId === folderId;
      return false;
    };
    const out: MoveDestination[] = [];
    const addFolders = (parentKey: NodeKey) => {
      for (const childKey of model.nodes.get(parentKey)?.childKeys ?? []) {
        const child = model.nodes.get(childKey);
        if (!child || child.kind !== 'folder' || !child.id) continue;
        const f = snapshot.folders.find((x) => x.id === child.id);
        if (!f) continue;
        out.push({
          key: childKey,
          path: pathOf(index, { projectId: f.projectId, folderId: f.id }),
          projectId: f.projectId,
          folderId: f.id,
          current: isCurrent(f.projectId, f.id),
        });
        addFolders(childKey);
      }
    };
    out.push({ key: 'common', path: ['Common'], projectId: null, folderId: null, current: isCurrent(null, null) });
    addFolders('common');
    for (const projectKey of model.nodes.get('projects')?.childKeys ?? []) {
      const p = model.nodes.get(projectKey);
      if (!p?.id) continue;
      out.push({ key: projectKey, path: pathOf(index, { projectId: p.id, folderId: null }), projectId: p.id, folderId: null, current: isCurrent(p.id, null) });
      addFolders(projectKey);
    }
    return out;
  }

  // Trash ---------------------------------------------------------------------------
  /** Flushes the open note first so its pending text is saved before the note can leave with the batch. */
  private async trash(call: () => Promise<Result<TrashResultType>>): Promise<Outcome<TrashResultType>> {
    await this.deps.tabs.flushActive();
    const res = await call();
    if (!res.ok) return this.fail(res);
    await this.reload();
    return okOutcome(res.data);
  }
  trashProject(projectId: string): Promise<Outcome<TrashResultType>> {
    return this.trash(() => this.deps.bridge.project.trash({ projectId }));
  }
  trashFolder(folderId: string): Promise<Outcome<TrashResultType>> {
    return this.trash(() => this.deps.bridge.folder.trash({ folderId }));
  }
  trashNote(noteId: string): Promise<Outcome<TrashResultType>> {
    return this.trash(() => this.deps.bridge.note.trash({ noteId }));
  }

  async restore(batchId: string): Promise<Outcome<TrashRestoreResponseType>> {
    const res = await this.deps.bridge.trash.restore({ batchId });
    if (!res.ok) return this.fail(res);
    const where = res.data.path.join(' › ');
    this.deps.notices.push(
      res.data.relocated
        ? `Restored to ${where} because its original location is in Trash or no longer exists`
        : `Restored to ${where}`,
      'info',
    );
    await this.afterChange(`${res.data.kind}:${res.data.id}`);
    return okOutcome(res.data);
  }

  async purge(batchId: string): Promise<Outcome> {
    const res = await this.deps.bridge.trash.purge({ target: { kind: 'batch', batchId }, confirmed: true });
    if (!res.ok) return this.fail(res);
    await this.reload();
    return okOutcome(undefined);
  }
  async emptyTrash(): Promise<Outcome> {
    const res = await this.deps.bridge.trash.purge({ target: { kind: 'all' }, confirmed: true });
    if (!res.ok) return this.fail(res);
    await this.reload();
    return okOutcome(undefined);
  }

  // Pin / favorite ----------------------------------------------------------------
  async setPinned(noteId: string, pinned: boolean): Promise<Outcome> {
    const res = await this.deps.bridge.note.setPinned({ noteId, pinned });
    if (!res.ok) return this.fail(res);
    await this.reload();
    return okOutcome(undefined);
  }
  async setFavorite(kind: ItemKindType, id: string, favorite: boolean): Promise<Outcome> {
    const res = await this.deps.bridge.item.setFavorite({ kind, id, favorite });
    if (!res.ok) return this.fail(res);
    await this.reload();
    return okOutcome(undefined);
  }
}
