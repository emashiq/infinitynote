import { DEFAULT_DOCUMENT_MAX_MB, DEFAULT_IMAGE_MAX_MB } from '../../shared/attachments/limits';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import { PUBLIC_SETTING_KEYS, SETTINGS, ThemeSetting, type PublicSettingKey, type SettingValue } from '../../shared/contracts/settings';
import type { EditorServices } from '../editor/editor-services';
import type { AttachmentLimits } from '../editor/uploader';
import { NoticeStore } from './notice-store';
import { createStore, type Store, type Timers } from './store';
import { ThemeStore, type ThemeEnv } from './theme-store';

const LIMIT_KEYS = { 'attachments.imageMaxMb': 'imageMaxMb', 'attachments.documentMaxMb': 'documentMaxMb' } as const;

export type PublicSettingValues = Partial<{ [K in PublicSettingKey]: SettingValue<K> }>;

/** What every window needs: theme, notices, attachment limits and the editor services (plan section 9.2). */
export interface CoreServices {
  bridge: InfinityBridge;
  theme: ThemeStore;
  notices: NoticeStore;
  /** Attachment size limits from the public settings (followed live through settings:changed). */
  attachmentLimits: Store<AttachmentLimits>;
  /** What every note editor uses from the app; one stable object. */
  editor: EditorServices;
  /** Reads the public settings once and applies the theme and the limits; returns the values for the window's own use. */
  loadSettings(): Promise<PublicSettingValues | null>;
  /** Keeps an unsubscribe function to run on dispose. */
  track(off: () => void): void;
  dispose(): void;
}

export function createCoreServices(bridge: InfinityBridge, deps: { timers: Timers; themeEnv: ThemeEnv | null }): CoreServices {
  const notices = new NoticeStore(deps.timers);
  const theme = new ThemeStore(bridge, deps.themeEnv);
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
  const unsubscribers: Array<() => void> = [
    // Settings changes from any window: the theme and the attachment limits follow them.
    bridge.subscribe('settings:changed', ({ key, value }) => {
      setLimit(key, value);
      if (key !== 'appearance.theme') return;
      const parsed = ThemeSetting.safeParse(value);
      if (parsed.success && theme.store.getState().value !== parsed.data) theme.hydrate(parsed.data);
    }),
  ];

  return {
    bridge,
    theme,
    notices,
    attachmentLimits,
    editor,
    async loadSettings() {
      const res = await bridge.settings.get({ keys: PUBLIC_SETTING_KEYS });
      if (!res.ok) return null;
      const values = res.data.values as PublicSettingValues;
      if (values['appearance.theme']) theme.hydrate(values['appearance.theme']);
      for (const key of Object.keys(LIMIT_KEYS)) setLimit(key, values[key as keyof typeof LIMIT_KEYS]);
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
