import type { AppInfoType } from '../../shared/contracts/app';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { ReminderViewType } from '../../shared/contracts/reminders';
import type { WidgetStateType } from '../../shared/contracts/widget';
import type { AppOpenNoteEventType } from '../../shared/contracts/windows';
import { RemindersStore } from '../reminders/reminders-store';
import { CommentsStore } from '../comments/comments-store';
import { GraphStore } from '../graph/graph-store';
import { EditorHandle } from '../editor/editor-handle';
import { drawExportDiagrams } from '../editor/diagram/export-diagrams';
import type { DocumentHost, EditorServices, ReferenceHost } from '../editor/editor-services';
import type { AttachmentPrefs } from '../editor/uploader';
import { createCommandRunner, type CommandRunner } from './commands';
import { createDocumentCommands, type DocumentCommands } from './document-commands';
import { createPortabilityCommands, type PortabilityCommands } from './portability-commands';
import { browserHideEvents, createCoreServices } from './core-services';
import { HomeStore } from './home-store';
import { LayoutStore } from './layout-store';
import { unsavedFlushNotice, type NoticeStore } from './notice-store';
import { textIsSafe } from '../notes/note-controller';
import { createStore, realTimers, uuidv4, type Store, type Timers } from './store';
import { TabsStore } from './tabs-store';
import { browserThemeEnv, type ThemeEnv, type ThemeStore } from './theme-store';
import { TreeStore } from './tree-store';
import { UiStore } from './ui-store';
import { WindowSettingsStore } from './window-settings-store';

export interface AppDeps {
  now?: () => number;
  timers?: Timers;
  viewport?: { width(): number; onResize(cb: () => void): () => void };
  randomUUID?: () => string;
  themeEnv?: ThemeEnv | null;
  /** Window-level lifecycle events used to flush the active note; defaults to window. */
  lifecycle?: { onHide(cb: () => void): () => void } | null;
  /** Notes main asked this window to open while it loaded (the window:getState handshake, D-071). */
  initialOpens?: readonly AppOpenNoteEventType[];
  /** A Reminders view main asked this window to show while it loaded (summary notification click). */
  initialReminders?: ReminderViewType | null;
  /** The reminder widget's state when the window opened (D-086). */
  initialWidget?: WidgetStateType;
}

export interface MetaState {
  info: AppInfoType | null;
}

export interface AppServices {
  bridge: InfinityBridge;
  viewId: string;
  now: () => number;
  meta: Store<MetaState>;
  theme: ThemeStore;
  tree: TreeStore;
  tabs: TabsStore;
  home: HomeStore;
  layout: LayoutStore;
  ui: UiStore;
  notices: NoticeStore;
  commands: CommandRunner;
  /** Backup, restore, export and import (D-099). */
  portability: PortabilityCommands;
  /** Creating, importing and opening documents (D-118). */
  documents: DocumentCommands;
  /** The comments of the item in the active tab (D-165). */
  comments: CommentsStore;
  /** The relation graph page (D-170). */
  graph: GraphStore;
  windowSettings: WindowSettingsStore;
  reminders: RemindersStore;
  /** Attachment limits and "When adding files" from the public settings (followed live through settings:changed). */
  attachmentPrefs: Store<AttachmentPrefs>;
  /** What every note editor uses from the app; one stable object. */
  editor: EditorServices;
  /** The active note tab's editor as the tab strip sees it: Enter in the tab's title moves into the text (D-102). */
  noteEditor: EditorHandle;
  ready: Promise<void>;
  init(): Promise<void>;
  dispose(): Promise<void>;
}

function browserViewport(): NonNullable<AppDeps['viewport']> {
  return {
    width: () => (typeof window === 'undefined' ? 1100 : window.innerWidth),
    onResize: (cb) => {
      if (typeof window === 'undefined') return () => undefined;
      window.addEventListener('resize', cb);
      return () => window.removeEventListener('resize', cb);
    },
  };
}

/** The main window's services: the shared core plus the tree, tabs, Home, layout and commands. */
export function createAppServices(bridge: InfinityBridge, deps: AppDeps = {}): AppServices {
  const timers = deps.timers ?? realTimers;
  const uuid = deps.randomUUID ?? uuidv4;
  const viewport = deps.viewport ?? browserViewport();
  const viewId = uuid();
  const now = deps.now ?? (() => Date.now());

  const core = createCoreServices(bridge, { timers, themeEnv: deps.themeEnv === undefined ? browserThemeEnv() : deps.themeEnv, canWriteSettings: true });
  const { notices, theme } = core;
  const meta = createStore<MetaState>({ info: null });
  const tabs = new TabsStore({ bridge, notices, timers, viewId, uuid });
  const tree = new TreeStore({ bridge, tabs, notices, timers });
  const home = new HomeStore(bridge);
  const layout = new LayoutStore(bridge, viewport.width());
  const ui = new UiStore();
  const noteEditor = new EditorHandle();
  const portability = createPortabilityCommands({ bridge, notices, ui, flushActive: () => tabs.flushActive(), noteDiagrams: () => drawExportDiagrams(noteEditor.current()) });
  const documents = createDocumentCommands({ bridge, tree, tabs, ui, notices, attachmentPrefs: core.attachmentPrefs });
  const comments = new CommentsStore({
    bridge,
    notify: (message) => notices.push(message, 'info'),
    showPanel: () => {
      if (!layout.panelVisible()) layout.togglePanel();
    },
  });
  const graph = new GraphStore({ bridge, tabs });
  const commands = createCommandRunner({ bridge, tree, tabs, home, layout, ui, notices, portability, documents, comments, graph });
  const windowSettings = new WindowSettingsStore(bridge);
  const reminders = new RemindersStore(
    {
      bridge,
      notices,
      tabs,
      homeScope: () => home.store.getState().scope,
      openEditor: (reminder) => ui.openDialog({ kind: 'reminder', noteId: reminder.noteId, reminder, blockId: reminder.blockId, title: reminder.title }),
    },
    deps.initialWidget ?? { open: false, collapsed: false, alwaysOnTop: false },
  );
  // Attached and linked files of a note open in the app as documents (main window only, D-118).
  const documentHost: DocumentHost = {
    openAttachment: (noteId, attachmentId) => void documents.openFromAttachment(noteId, attachmentId),
    openLink: (noteId, linkId) => void documents.openFromLink(noteId, linkId),
  };
  // Reference chips show live titles from the tree and open their target in a tab (D-098).
  const references: ReferenceHost = {
    titleOf: (noteId) => {
      const t = tree.store.getState();
      if (t.status !== 'ready') return undefined;
      return t.model.nodes.get(`note:${noteId}`)?.label ?? null;
    },
    documentOf: (documentId) => {
      const t = tree.store.getState();
      if (t.status !== 'ready') return undefined;
      return t.model.nodes.get(`document:${documentId}`) ?? null;
    },
    subscribe: (listener) => tree.store.subscribe(listener),
    open: (noteId, blockId) => void tabs.openNote(noteId, { blockId }),
    openDocument: (documentId, target) => void tabs.openDocument(documentId, target ? { target } : {}),
    createNote: async (besideNoteId, title) => {
      const t = tree.store.getState();
      const beside = t.status === 'ready' ? t.snapshot.notes.find((n) => n.id === besideNoteId) : undefined;
      const res = await tree.createNote({ projectId: beside?.projectId ?? null, folderId: beside?.folderId ?? null }, { sticky: false, title });
      if (!res.ok) {
        notices.push(res.message, 'error');
        return null;
      }
      return { id: res.data.note.id, title: res.data.note.title };
    },
  };
  const editor: EditorServices = { ...core.editor, references, documents: documentHost, comments };
  let lastScope = home.store.getState().scope;
  let lastActive = tabs.store.getState().session.activeTabId;

  async function init(): Promise<void> {
    const [settings, info, caps] = await Promise.all([core.loadSettings(), bridge.app.getInfo(), bridge.capabilities.get(), tabs.init(), tree.reload()]);
    if (info.ok) meta.setState({ info: info.data });
    // Re-sample the viewport: the width read at construction can be a transient narrow value.
    layout.setViewportWidth(viewport.width());
    if (settings) {
      layout.hydrate({
        treeOpen: settings['layout.treeOpen'] ?? true,
        panelOpen: settings['layout.panelOpen'] ?? false,
        treeWidth: settings['layout.treeWidth'] ?? 248,
      });
      if (settings['home.scope']) home.hydrate(settings['home.scope']);
      if (settings['tree.expanded']) tree.hydrate(settings['tree.expanded']);
      windowSettings.hydrate(settings, caps.ok ? caps.data : null);
    }
    // Notes main was asked to open while this window loaded, for example a dock (D-071).
    for (const open of deps.initialOpens ?? []) await tabs.openNote(open.noteId, { blockId: open.blockId });
    await Promise.all([home.load(), reminders.init(deps.initialReminders ?? null), announceRestore()]);
  }

  /** A restore applied at this start says how it went (D-099). */
  async function announceRestore(): Promise<void> {
    const status = await bridge.backup.status();
    const restore = status.ok ? status.data.lastRestore : null;
    if (restore) notices.push(restore.message, restore.status === 'failed' ? 'error' : 'info');
  }

  core.track(bridge.subscribe('settings:changed', ({ key, value }) => windowSettings.applyChange(key, value)));
  // Event wiring: tree changes, live sync of the active note tab (D-103), flush requests and note opens from main.
  core.track(bridge.subscribe('collab:steps', (event) => tabs.activeController()?.onSteps(event)));
  core.track(bridge.subscribe('collab:status', (event) => tabs.activeController()?.onStatus(event)));
  core.track(bridge.subscribe('collab:reset', (event) => tabs.activeController()?.onReset(event)));
  core.track(
    bridge.subscribe('tree:changed', (event) => {
      void tree.handleChanged(event).then(() => home.refresh());
    }),
  );
  // Window close and quit (INF-SAVE-01, D-072): flush, then tell main whether the text is safe; if not, say why the
  // window stays open (or the app did not quit).
  core.track(
    bridge.subscribe('app:flush-request', ({ flushId, reason }) => {
      void tabs.flushActive().then((result) => {
        const saved = textIsSafe(result);
        if (!saved) notices.push(unsavedFlushNotice(reason), 'error');
        return bridge.app.flushed({ flushId, saved });
      });
    }),
  );
  core.track(bridge.subscribe('app:openNote', ({ noteId, blockId }) => void tabs.openNote(noteId, { blockId })));
  // Reminders (plan section 9.6): views re-read on every change; alerts, the widget state and Reminders opens from main.
  core.track(bridge.subscribe('reminder:changed', () => void reminders.refresh()));
  core.track(bridge.subscribe('reminder:alert', (event) => reminders.onAlert(event)));
  core.track(bridge.subscribe('widget:state', (state) => reminders.onWidgetState(state)));
  core.track(bridge.subscribe('app:openReminders', ({ view }) => void reminders.openView(view)));
  core.track(
    home.store.subscribe(() => {
      const scope = home.store.getState().scope;
      if (scope === lastScope) return;
      lastScope = scope;
      void reminders.refreshSummary();
    }),
  );
  core.track(viewport.onResize(() => layout.setViewportWidth(viewport.width())));
  // Refresh Home whenever its tab becomes active.
  core.track(
    tabs.store.subscribe(() => {
      const active = tabs.store.getState().session.activeTabId;
      if (active !== lastActive) {
        lastActive = active;
        if (active === 'home') void home.refresh();
      }
    }),
  );
  const lifecycle = deps.lifecycle === undefined ? browserHideEvents() : deps.lifecycle;
  if (lifecycle) core.track(lifecycle.onHide(() => void tabs.flushActive()));

  const ready = init();

  return {
    bridge,
    viewId,
    now,
    meta,
    theme,
    tree,
    tabs,
    home,
    layout,
    ui,
    notices,
    commands,
    portability,
    documents,
    comments,
    graph,
    windowSettings,
    reminders,
    attachmentPrefs: core.attachmentPrefs,
    editor,
    noteEditor,
    ready,
    init: () => ready,
    async dispose() {
      core.dispose();
      await tabs.dispose();
    },
  };
}
