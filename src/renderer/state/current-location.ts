import type { LocationType } from '../../shared/contracts/hierarchy';
import type { HomeScopeType } from '../../shared/contracts/home';
import type { TabType } from '../../shared/contracts/session';
import { locationOfNode, type NodeKey, type TreeModel } from '../../shared/tree/tree-model';

export interface LocationInput {
  treeHasFocus: boolean;
  selectedKey: NodeKey | null;
  model: TreeModel;
  activeTab: TabType;
  /** Location of the note shown in the active note tab, if any. */
  activeNote: LocationType | null;
  homeScope: HomeScopeType;
}

/** Where Ctrl+N, Ctrl+Shift+N and the quick actions put a new item (D-047). */
export function resolveNewItemLocation(input: LocationInput): LocationType {
  if (input.treeHasFocus && input.selectedKey) {
    const loc = locationOfNode(input.model, input.selectedKey);
    if (loc) return loc;
  }
  if (input.activeTab.kind === 'note' && input.activeNote) return input.activeNote;
  if (input.activeTab.kind === 'home' && input.homeScope.kind === 'project') {
    return { projectId: input.homeScope.projectId, folderId: null };
  }
  return { projectId: null, folderId: null };
}
