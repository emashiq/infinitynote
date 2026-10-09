import type { LocationType } from '../../shared/contracts/hierarchy';
import type { AppServices } from './app-services';
import { resolveNewItemLocation } from './current-location';

export type CommandId =
  | 'note.new'
  | 'note.newPlain'
  | 'note.find'
  | 'note.insertReference'
  | 'note.float'
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
  | 'palette.open'
  | 'help.shortcuts'
  | 'backup.create'
  | 'backup.restore'
  | 'note.exportMarkdown'
  | 'note.exportText'
  | 'notes.exportAll'
  | 'notes.import'
  | 'note.lock'
  | 'note.lockNow'
  | 'notes.lockAll';

export interface CommandRunner {
  run(id: CommandId): Promise<void>;
  /** Where a new note, sticky or folder would be created right now. */
  currentLocation(): LocationType;
  /** Opens (or focuses) the note's sticky window; an open tab of the note is flushed first (INF-STKY-01). */
  float(noteId: string): Promise<void>;
  /** Creates a sticky at the location (the current one by default) and floats it; no tab opens (D-069). */
  newSticky(location?: LocationType): Promise<void>;
  /** "Lock note…", or the lock settings of a locked note (D-111). */
  openLock(noteId: string): void;
  /** Locks an unlocked note again; its open tab is saved first. */
  lockNow(noteId: string): Promise<void>;
  /** Locks every unlocked note again. */
  lockAll(): Promise<void>;
}

export function createCommandRunner(
  services: Pick<AppServices, 'bridge' | 'tree' | 'tabs' | 'home' | 'layout' | 'ui' | 'notices' | 'portability'>,
): CommandRunner {
  const { bridge, tree, tabs, home, layout, ui, notices, portability } = services;

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

  /** Creates a note where the user is working (rich text unless a plain-text note is asked for) and opens it. */
  const newNote = async (format?: 'plain'): Promise<void> => {
    const res = await tree.createNote(currentLocation(), { sticky: false, ...(format ? { format } : {}) });
    if (!res.ok) {
      notices.push(res.message, 'error');
      return;
    }
    await tabs.openNote(res.data.note.id);
    ui.requestFocus({ target: 'noteTitle', noteId: res.data.note.id });
  };

  const activeNoteId = (): string | null => {
    const session = tabs.store.getState().session;
    const active = session.tabs.find((t) => t.id === session.activeTabId);
    return active?.kind === 'note' ? active.noteId : null;
  };

  const float = async (noteId: string): Promise<void> => {
    if (tabs.activeController()?.noteId === noteId) await tabs.flushActive();
    const res = await bridge.sticky.float({ noteId });
    if (!res.ok) notices.push(res.error.message, 'error');
  };

  const newSticky = async (location: LocationType = currentLocation()): Promise<void> => {
    const res = await tree.createNote(location, { sticky: true });
    if (!res.ok) {
      notices.push(res.message, 'error');
      return;
    }
    await float(res.data.note.id);
  };

  const openLock = (noteId: string): void => {
    const locked = tree.store.getState().snapshot.notes.find((n) => n.id === noteId)?.locked ?? false;
    ui.openDialog({ kind: locked ? 'lockSettings' : 'lockNote', noteId });
  };

  const lockNow = async (noteId: string): Promise<void> => {
    if (tabs.activeController()?.noteId === noteId) await tabs.flushActive();
    const res = await bridge.lock.lockNow({ noteId });
    if (!res.ok) notices.push(res.error.message, 'error');
  };

  const lockAll = async (): Promise<void> => {
    await tabs.flushActive();
    const res = await bridge.lock.lockAll();
    if (!res.ok) notices.push(res.error.message, 'error');
    else notices.push(res.data.locked === 0 ? 'No note was unlocked' : `Locked ${res.data.locked === 1 ? '1 note' : `${res.data.locked} notes`} again`, 'info');
  };

  return {
    currentLocation,
    float,
    newSticky,
    openLock,
    lockNow,
    lockAll,
    async run(id) {
      switch (id) {
        case 'note.new':
          return newNote();
        case 'note.newPlain':
          return newNote('plain');
        case 'note.find': {
          // Only a note tab has a find bar (D-058).
          const noteId = activeNoteId();
          if (noteId) ui.requestFocus({ target: 'noteFind', noteId });
          return;
        }
        case 'note.insertReference': {
          const noteId = activeNoteId();
          if (noteId) ui.requestFocus({ target: 'noteReference', noteId });
          return;
        }
        case 'note.float': {
          const noteId = activeNoteId();
          if (noteId) await float(noteId);
          return;
        }
        case 'sticky.new':
          return newSticky();
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
        case 'help.shortcuts':
          ui.openDialog({ kind: 'shortcuts' });
          return;
        case 'backup.create':
          return portability.backUp();
        case 'backup.restore':
          return portability.restore();
        case 'note.exportMarkdown':
        case 'note.exportText': {
          // Exporting needs a note tab; elsewhere the command does nothing (the menu item is disabled).
          const noteId = activeNoteId();
          if (noteId) await portability.exportNote(noteId, id === 'note.exportMarkdown' ? 'markdown' : 'text');
          return;
        }
        case 'notes.exportAll':
          return portability.exportAll();
        case 'notes.import':
          return portability.importNotes();
        case 'note.lock': {
          const noteId = activeNoteId();
          if (noteId) openLock(noteId);
          return;
        }
        case 'note.lockNow': {
          const noteId = activeNoteId();
          if (noteId) await lockNow(noteId);
          return;
        }
        case 'notes.lockAll':
          return lockAll();
      }
    },
  };
}
