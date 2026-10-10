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
  | 'note.newLocked'
  | 'sticky.newLocked'
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
  | 'note.exportHtml'
  | 'note.exportPdf'
  | 'note.print'
  | 'notes.exportAll'
  | 'notes.import'
  | 'note.lock'
  | 'note.lockNow'
  | 'notes.lockAll'
  | 'document.import'
  | 'document.newDocx'
  | 'document.newXlsx'
  | 'document.newPptx'
  | 'comment.add'
  | 'go.graph';

export interface CommandRunner {
  run(id: CommandId): Promise<void>;
  /** Where a new note, sticky or folder would be created right now. */
  currentLocation(): LocationType;
  /** Opens (or focuses) the note's sticky window; an open tab of the note is flushed first (INF-STKY-01). */
  float(noteId: string): Promise<void>;
  /** Creates a sticky at the location (the current one by default) and floats it; no tab opens (D-069). */
  newSticky(location?: LocationType): Promise<void>;
  /** "New locked note" or "New locked sticky" at the location (the current one by default; D-171). */
  newLocked(sticky: boolean, location?: LocationType): void;
  /** "Lock note…", or the lock settings of a locked note (D-111). */
  openLock(noteId: string): void;
  /** Locks an unlocked note again; its open tab is saved first. */
  lockNow(noteId: string): Promise<void>;
  /** Locks every unlocked note again. */
  lockAll(): Promise<void>;
}

export function createCommandRunner(
  services: Pick<AppServices, 'bridge' | 'tree' | 'tabs' | 'home' | 'layout' | 'ui' | 'notices' | 'portability' | 'documents' | 'comments' | 'graph'>,
): CommandRunner {
  const { bridge, tree, tabs, home, layout, ui, notices, portability, documents, comments, graph } = services;

  const currentLocation = (): LocationType => {
    const t = tree.store.getState();
    const session = tabs.store.getState().session;
    const activeTab = session.tabs.find((x) => x.id === session.activeTabId) ?? { id: 'home' as const, kind: 'home' as const };
    const activeKey = activeTab.kind === 'note' ? `note:${activeTab.noteId}` : activeTab.kind === 'document' ? `document:${activeTab.documentId}` : null;
    const activeNote = activeKey ? (t.model.nodes.get(activeKey)?.location ?? null) : null;
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

  const activeTab = () => {
    const session = tabs.store.getState().session;
    return session.tabs.find((t) => t.id === session.activeTabId);
  };
  const activeNoteId = (): string | null => {
    const active = activeTab();
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

  const newLocked = (sticky: boolean, location: LocationType = currentLocation()): void => ui.openDialog({ kind: 'createLocked', location, sticky });

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
    newLocked,
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
          // Note tabs (D-058) and document viewers with a find bar (D-130).
          const active = activeTab();
          if (active?.kind === 'note') ui.requestFocus({ target: 'noteFind', noteId: active.noteId });
          else if (active?.kind === 'document') ui.requestDocumentFind(active.documentId);
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
        case 'note.newLocked':
          return newLocked(false);
        case 'sticky.newLocked':
          return newLocked(true);
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
        case 'go.graph':
          await graph.open({ kind: 'all' });
          return;
        case 'comment.add':
          comments.start();
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
        case 'note.exportHtml':
        case 'note.exportPdf': {
          const noteId = activeNoteId();
          if (noteId) await portability.exportNoteDocument(noteId, id === 'note.exportHtml' ? 'html' : 'pdf');
          return;
        }
        case 'note.print': {
          const noteId = activeNoteId();
          if (noteId) await portability.printNote(noteId);
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
        case 'document.import':
          return documents.importFiles(currentLocation());
        case 'document.newDocx':
          return documents.createBlank('docx', currentLocation());
        case 'document.newXlsx':
          return documents.createBlank('xlsx', currentLocation());
        case 'document.newPptx':
          return documents.createBlank('pptx', currentLocation());
      }
    },
  };
}
