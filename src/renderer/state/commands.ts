import type { LocationType } from '../../shared/contracts/hierarchy';
import type { AppServices } from './app-services';
import { resolveNewItemLocation } from './current-location';

export type CommandId =
  | 'note.new'
  | 'sticky.new'
  | 'project.new'
  | 'folder.new'
  | 'go.home'
  | 'go.stickies'
  | 'go.reminders'
  | 'go.settings'
  | 'view.toggleTree'
  | 'view.togglePanel'
  | 'tab.close'
  | 'tab.next'
  | 'tab.prev'
  | 'palette.open';

export interface CommandRunner {
  run(id: CommandId): Promise<void>;
  /** Where a new note, sticky or folder would be created right now. */
  currentLocation(): LocationType;
}

export function createCommandRunner(services: Pick<AppServices, 'tree' | 'tabs' | 'home' | 'layout' | 'ui' | 'notices'>): CommandRunner {
  const { tree, tabs, home, layout, ui, notices } = services;

  const currentLocation = (): LocationType => {
    const t = tree.store.getState();
    const session = tabs.store.getState().session;
    const activeTab = session.tabs.find((x) => x.id === session.activeTabId) ?? { id: 'home' as const, kind: 'home' as const };
    const activeNote = activeTab.kind === 'note' ? (t.model.nodes.get(`note:${activeTab.noteId}`)?.location ?? null) : null;
    return resolveNewItemLocation({
      treeHasFocus: t.hasFocus,
      selectedKey: t.selectedKey,
      model: t.model,
      activeTab,
      activeNote,
      homeScope: home.store.getState().scope,
    });
  };

  const newNote = async (sticky: boolean): Promise<void> => {
    const res = await tree.createNote(currentLocation(), { sticky });
    if (!res.ok) {
      notices.push(res.message, 'error');
      return;
    }
    await tabs.openNote(res.data.note.id);
    ui.requestFocus({ target: 'noteTitle', noteId: res.data.note.id });
  };

  return {
    currentLocation,
    async run(id) {
      switch (id) {
        case 'note.new':
          return newNote(false);
        case 'sticky.new':
          return newNote(true);
        case 'project.new':
          ui.openDialog({ kind: 'newProject' });
          return;
        case 'folder.new': {
          const loc = currentLocation();
          ui.openDialog({ kind: 'newFolder', target: { projectId: loc.projectId, parentId: loc.folderId } });
          return;
        }
        case 'go.home':
          await tabs.activate('home');
          return;
        case 'go.stickies':
          await tabs.openPage('stickies');
          return;
        case 'go.reminders':
          await tabs.openPage('reminders');
          return;
        case 'go.settings':
          await tabs.openPage('settings');
          return;
        case 'view.toggleTree':
          layout.toggleTree();
          return;
        case 'view.togglePanel':
          layout.togglePanel();
          return;
        case 'tab.close':
          await tabs.closeActive();
          return;
        case 'tab.next':
          await tabs.next();
          return;
        case 'tab.prev':
          await tabs.prev();
          return;
        case 'palette.open':
          ui.openPalette();
          return;
      }
    },
  };
}
