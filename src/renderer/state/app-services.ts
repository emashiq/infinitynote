import { DEFAULT_DOCUMENT_MAX_MB, DEFAULT_IMAGE_MAX_MB } from '../../shared/attachments/limits';
import type { AppInfoType } from '../../shared/contracts/app';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import { PUBLIC_SETTING_KEYS, SETTINGS, ThemeSetting } from '../../shared/contracts/settings';
import type { EditorServices } from '../editor/editor-services';
import type { AttachmentLimits } from '../editor/uploader';
import { createCommandRunner, type CommandRunner } from './commands';
import { HomeStore } from './home-store';
import { LayoutStore } from './layout-store';
import { NoticeStore } from './notice-store';
import { createStore, realTimers, uuidv4, type Store, type Timers } from './store';
import { TabsStore } from './tabs-store';
import { browserThemeEnv, ThemeStore, type ThemeEnv } from './theme-store';
import { TreeStore } from './tree-store';
import { UiStore } from './ui-store';

export interface AppDeps {
  now?: () => number;
  timers?: Timers;
  viewport?: { width(): number; onResize(cb: () => void): () => void };
  randomUUID?: () => string;
  themeEnv?: ThemeEnv | null;
  /** Window-level lifecycle events used to flush the active note; defaults to window. */
  lifecycle?: { onHide(cb: () => void): () => void } | null;
}

export interface MetaState {
  info: AppInfoType | null;
}

const LIMIT_KEYS = { 'attachments.imageMaxMb': 'imageMaxMb', 'attachments.documentMaxMb': 'documentMaxMb' } as const;

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
  /** Attachment size limits from the public settings (followed live through settings:changed). */
  attachmentLimits: Store<AttachmentLimits>;
  /** What every note editor uses from the app; one stable object. */
  editor: EditorServices;
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

function browserLifecycle(): NonNullable<AppDeps['lifecycle']> | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  return {
    onHide: (cb) => {
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') cb();
      };
      window.addEventListener('pagehide', cb);
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
        window.removeEventListener('pagehide', cb);
        document.removeEventListener('visibilitychange', onVisibility);
      };
    },
  };
}

export function createAppServices(bridge: InfinityBridge, deps: AppDeps = {}): AppServices {
  const timers = deps.timers ?? realTimers;
  const uuid = deps.randomUUID ?? uuidv4;
  const viewport = deps.viewport ?? browserViewport();
  const viewId = uuid();
  const now = deps.now ?? (() => Date.now());

  const notices = new NoticeStore(timers);
  const meta = createStore<MetaState>({ info: null });
  const theme = new ThemeStore(bridge, deps.themeEnv === undefined ? browserThemeEnv() : deps.themeEnv);
  const tabs = new TabsStore({ bridge, notices, timers, viewId, uuid });
  const tree = new TreeStore({ bridge, tabs, notices, timers });
  const home = new HomeStore(bridge);
  const layout = new LayoutStore(bridge, viewport.width());
  const ui = new UiStore();
  const commands = createCommandRunner({ tree, tabs, home, layout, ui, notices });
  const attachmentLimits = createStore<AttachmentLimits>({ imageMaxMb: DEFAULT_IMAGE_MAX_MB, documentMaxMb: DEFAULT_DOCUMENT_MAX_MB });
  const editor: EditorServices = {
    bridge,
    notify: (message) => notices.push(message, 'error'),
    limits: () => attachmentLimits.getState(),
  };
  const setLimit = (key: string, value: unknown): void => {
    if (!(key in LIMIT_KEYS)) return;
    const limitKey = key as keyof typeof LIMIT_KEYS;
    const parsed = SETTINGS[limitKey].schema.safeParse(value);
    if (parsed.success) attachmentLimits.setState({ [LIMIT_KEYS[limitKey]]: parsed.data });
  };

  const unsubscribers: Array<() => void> = [];
  let lastActive = tabs.store.getState().session.activeTabId;

  async function init(): Promise<void> {
    const [settings, info] = await Promise.all([
      bridge.settings.get({ keys: PUBLIC_SETTING_KEYS }),
      bridge.app.getInfo(),
      tabs.init(),
      tree.reload(),
    ]);
    if (info.ok) meta.setState({ info: info.data });
    // Re-sample the viewport: the width read at construction can be a transient narrow value.
    layout.setViewportWidth(viewport.width());
    if (settings.ok) {
      const v = settings.data.values;
      if (v['appearance.theme']) theme.hydrate(v['appearance.theme']);
      layout.hydrate({
        treeOpen: v['layout.treeOpen'] ?? true,
        panelOpen: v['layout.panelOpen'] ?? true,
        treeWidth: v['layout.treeWidth'] ?? 248,
      });
      if (v['home.scope']) home.hydrate(v['home.scope']);
      if (v['tree.expanded']) tree.hydrate(v['tree.expanded']);
      for (const key of Object.keys(LIMIT_KEYS)) setLimit(key, v[key as keyof typeof LIMIT_KEYS]);
    }
    await home.load();
  }

  // Event wiring: settings changes from other writers and tree changes from main.
  unsubscribers.push(
    bridge.subscribe('settings:changed', ({ key, value }) => {
      setLimit(key, value);
      if (key !== 'appearance.theme') return;
      const parsed = ThemeSetting.safeParse(value);
      if (parsed.success && theme.store.getState().value !== parsed.data) theme.hydrate(parsed.data);
    }),
    // Note events go to the controller of the active note tab (the only one that exists).
    bridge.subscribe('note:revision', (event) => tabs.activeController()?.onRevision(event)),
    bridge.subscribe('note:lease', (event) => tabs.activeController()?.onLease(event)),
    bridge.subscribe('lease:release-request', ({ noteId }) => {
      const controller = tabs.activeController();
      if (controller?.noteId === noteId) void controller.onReleaseRequest();
    }),
    bridge.subscribe('tree:changed', (event) => {
      void tree.handleChanged(event).then(() => home.refresh());
    }),
    // Window close and quit (INF-SAVE-01): flush, then acknowledge even when the flush failed (main keeps drafts).
    bridge.subscribe('app:flush-request', ({ flushId }) => {
      void tabs.flushActive().finally(() => bridge.app.flushed({ flushId }));
    }),
    viewport.onResize(() => layout.setViewportWidth(viewport.width())),
    // Refresh Home whenever its tab becomes active.
    tabs.store.subscribe(() => {
      const active = tabs.store.getState().session.activeTabId;
      if (active !== lastActive) {
        lastActive = active;
        if (active === 'home') void home.refresh();
      }
    }),
  );
  const lifecycle = deps.lifecycle === undefined ? browserLifecycle() : deps.lifecycle;
  if (lifecycle) unsubscribers.push(lifecycle.onHide(() => void tabs.flushActive()));

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
    attachmentLimits,
    editor,
    ready,
    init: () => ready,
    async dispose() {
      for (const off of unsubscribers.splice(0)) off();
      theme.dispose();
      await tabs.dispose();
    },
  };
}
