import type { AddAction } from '../../shared/attachments/file-choice';
import { DEFAULT_DOCUMENT_MAX_MB, DEFAULT_IMAGE_MAX_MB } from '../../shared/attachments/limits';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import { PUBLIC_SETTING_KEYS, SETTINGS, ThemeSetting, type PublicSettingKey, type SettingValue } from '../../shared/contracts/settings';
import type { EditorServices } from '../editor/editor-services';
import type { AttachmentPrefs } from '../editor/uploader';
import { SuggestionContext } from '../reminders/suggestion-context';
import { NoticeStore } from './notice-store';
import { createStore, type Store, type Timers } from './store';
import { ThemeStore, type ThemeEnv } from './theme-store';

const PREF_KEYS = { 'attachments.imageMaxMb': 'imageMaxMb', 'attachments.documentMaxMb': 'documentMaxMb', 'attachments.addFiles': 'addFiles' } as const;

export type PublicSettingValues = Partial<{ [K in PublicSettingKey]: SettingValue<K> }>;

/** What every window needs: theme, notices, attachment settings and the editor services (plan section 9.2). */
export interface CoreServices {
  bridge: InfinityBridge;
  theme: ThemeStore;
  notices: NoticeStore;
  /** Attachment limits and "When adding files" from the public settings (followed live through settings:changed). */
  attachmentPrefs: Store<AttachmentPrefs>;
  /** What every note editor uses from the app; one stable object. */
  editor: EditorServices;
  /** Reads the public settings once and applies the theme and the attachment settings; returns them for the window's own use. */
  loadSettings(): Promise<PublicSettingValues | null>;
  /** Keeps an unsubscribe function to run on dispose. */
  track(off: () => void): void;
  dispose(): void;
}

export function createCoreServices(
  bridge: InfinityBridge,
  deps: {
    timers: Timers;
    themeEnv: ThemeEnv | null;
    /** The main window writes settings; stickies and the widget only read them (D-064). */
    canWriteSettings?: boolean;
  },
): CoreServices {
  const notices = new NoticeStore(deps.timers);
  const theme = new ThemeStore(bridge, deps.themeEnv);
  const attachmentPrefs = createStore<AttachmentPrefs>({ imageMaxMb: DEFAULT_IMAGE_MAX_MB, documentMaxMb: DEFAULT_DOCUMENT_MAX_MB, addFiles: 'ask' });
  const suggestions = new SuggestionContext(bridge);
  const notify = (message: string) => notices.push(message, 'error');
  const rememberAddFiles = (action: AddAction): void => {
    attachmentPrefs.setState({ addFiles: action });
    void bridge.settings.set({ key: 'attachments.addFiles', value: action }).then((res) => {
      if (!res.ok) notify(res.error.message);
    });
  };
  const editor: EditorServices = {
    bridge,
    notify,
    attachmentPrefs: () => attachmentPrefs.getState(),
    ...(deps.canWriteSettings ? { rememberAddFiles } : {}),
    suggestions,
  };
  const setPref = (key: string, value: unknown): void => {
    if (!(key in PREF_KEYS)) return;
    const prefKey = key as keyof typeof PREF_KEYS;
    const parsed = SETTINGS[prefKey].schema.safeParse(value);
    if (parsed.success) attachmentPrefs.setState({ [PREF_KEYS[prefKey]]: parsed.data });
  };
  const unsubscribers: Array<() => void> = [
    // Settings changes from any window: the theme and the attachment settings follow them.
    bridge.subscribe('settings:changed', ({ key, value }) => {
      setPref(key, value);
      suggestions.applySetting(key, value);
      if (key !== 'appearance.theme') return;
      const parsed = ThemeSetting.safeParse(value);
      if (parsed.success && theme.store.getState().value !== parsed.data) theme.hydrate(parsed.data);
    }),
  ];

  return {
    bridge,
    theme,
    notices,
    attachmentPrefs,
    editor,
    async loadSettings() {
      const res = await bridge.settings.get({ keys: PUBLIC_SETTING_KEYS });
      if (!res.ok) return null;
      const values = res.data.values as PublicSettingValues;
      if (values['appearance.theme']) theme.hydrate(values['appearance.theme']);
      for (const key of Object.keys(PREF_KEYS)) setPref(key, values[key as keyof typeof PREF_KEYS]);
      for (const [key, value] of Object.entries(values)) suggestions.applySetting(key, value);
      return values;
    },
    track(off) {
      unsubscribers.push(off);
    },
    dispose() {
      for (const off of unsubscribers.splice(0)) off();
      theme.dispose();
    },
  };
}

/** pagehide or a hidden page, in a browser; the caller flushes. */
export function browserHideEvents(): { onHide(cb: () => void): () => void } | null {
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
