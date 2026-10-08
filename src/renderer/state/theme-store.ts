import type { InfinityBridge } from '../../shared/contracts/bridge';
import { applyTheme, resolveTheme, type ThemeSettingValue } from '../theme/theme';
import { createStore, failOutcome, okOutcome, type Outcome, type Store } from './store';

export interface ThemeEnv {
  prefersDark(): boolean;
  onSchemeChange(cb: () => void): () => void;
  apply(theme: 'light' | 'dark'): void;
}

export function browserThemeEnv(): ThemeEnv | null {
  if (typeof document === 'undefined' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  return {
    prefersDark: () => media.matches,
    onSchemeChange: (cb) => {
      media.addEventListener('change', cb);
      return () => media.removeEventListener('change', cb);
    },
    apply: (theme) => applyTheme(document.documentElement, theme),
  };
}

export interface ThemeState {
  value: ThemeSettingValue;
}

/** Owns the appearance.theme setting and applies it; follows the OS while the value is "system". */
export class ThemeStore {
  readonly store: Store<ThemeState> = createStore<ThemeState>({ value: 'system' });
  private stopWatching: (() => void) | null = null;

  constructor(
    private readonly bridge: InfinityBridge,
    private readonly env: ThemeEnv | null,
  ) {}

  private applyNow(): void {
    if (!this.env) return;
    this.env.apply(resolveTheme(this.store.getState().value, this.env.prefersDark()));
  }

  hydrate(value: ThemeSettingValue): void {
    this.store.setState({ value });
    this.applyNow();
    this.stopWatching?.();
    this.stopWatching = this.env ? this.env.onSchemeChange(() => this.applyNow()) : null;
  }

  async set(value: ThemeSettingValue): Promise<Outcome> {
    const previous = this.store.getState().value;
    this.hydrate(value);
    const res = await this.bridge.settings.set({ key: 'appearance.theme', value });
    if (!res.ok) {
      this.hydrate(previous);
      return failOutcome(res.error.code, res.error.message);
    }
    return okOutcome(undefined);
  }

  dispose(): void {
    this.stopWatching?.();
    this.stopWatching = null;
  }
}
